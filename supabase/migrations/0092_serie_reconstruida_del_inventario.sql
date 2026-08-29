-- 0092_serie_reconstruida_del_inventario.sql
--
-- La curva del valor de tu cartera HACIA ATRÁS, más allá del día en que se
-- estrenó la pantalla.
--
-- ── Qué había y por qué no bastaba ────────────────────────────────────────
-- `steam_portfolio_snapshots` (0088) es la única serie EXACTA: el cron apunta
-- cada día lo que valía tu inventario ese día, con las cantidades de ese día y
-- los precios de ese día. Impecable, y empieza el 27-08-2026, que es cuando se
-- estrenó. Antes de esa fecha no hay foto porque nadie la hizo.
--
-- Pero sí hay con qué reconstruirla, y es lo que hace esta función:
--   · `steam_price_history` sabe qué valía CADA OBJETO cada día, años atrás.
--   · `steam_ledger` sabe qué compraste y qué vendiste, y cuándo.
-- Con las cantidades de hoy y el libro se camina hacia atrás — «el 3 de marzo
-- tenía tres de estos, porque el cuarto lo compré en mayo»— y se multiplica por
-- el precio de aquel día.
--
-- ── Lo que esta reconstrucción NO puede saber, dicho aquí y en pantalla ────
-- El libro solo registra lo que pasó por DINERO. Lo que entró de otra forma no
-- deja rastro en ningún historial de Steam:
--   · una skin que salió de una caja: la caja sí está (`market_buy`), lo que
--     salió de ella no — abrirla no es una transacción;
--   · un drop de partida, un intercambio, un regalo: nunca tocaron la cartera.
-- Esos objetos se reconstruyen como si los hubieras tenido DESDE SIEMPRE, y por
-- tanto la línea de hace dos años cuenta cosas que entonces no tenías. Al revés
-- pasa lo mismo y resta: lo que vendiste ya no está en `steam_holdings`, así que
-- el recolector nunca pidió su histórico y el pasado se queda corto por ahí.
--
-- El error crece cuanto más atrás se mira, y no hay forma de acotarlo desde
-- aquí. Por eso la pantalla rotula la curva entera como aproximada — decisión
-- del usuario, 29-08-2026, sabiendo esto: una sola línea y un rótulo, en vez de
-- dos tramos con dos precisiones distintas.
--
-- ── Lo que esto cambia del reparto de confianza de 0088 ───────────────────
-- 0088 dejó escrito que `steam_price_history` «no toca ningún total: solo dibuja
-- la curva de un objeto en su ficha». Desde aquí eso ya no es cierto, y conviene
-- decirlo con todas las letras porque era una barrera deliberada.
--
-- Esa tabla es GLOBAL y la puede rellenar un cliente —`market/pricehistory` pide
-- cookie de sesión, así que no hay otra forma de traer los años pasados—, de
-- modo que ahora una vela inventada por un tercero puede deformar el tramo
-- reconstruido de la curva de otra persona, si los dos tienen el mismo objeto.
-- Se acepta, y por tres razones que se sostienen juntas:
--   · el daño llega hasta un DIBUJO rotulado como aproximado, y no hasta una
--     cifra guardada: `steam_portfolio_snapshots` la sigue escribiendo el cron
--     con precios de `source = 'server'`, y el total grande de la pantalla sale
--     de `steam_market_prices`, donde un precio de cliente no pisa a uno del
--     cron;
--   · la ingesta nunca pisa una vela ya escrita, así que envenenar exige llegar
--     antes que el dueño del objeto, no simplemente subir más tarde;
--   · desde este mismo cambio, `scripts/steam-prices` escribe la vela de HOY con
--     la clave de servicio y pisando la del día. De hoy en adelante la serie la
--     va llenando el cron, y lo que queda del cliente es el pasado.
--
-- La alternativa —no reconstruir nada— deja la pantalla como estaba: una curva
-- que empieza el día que se estrenó y no contesta la pregunta que se hace todo
-- el mundo. No merece la pena a cambio de esto.
--
-- ── Por qué es una función y no una lectura ───────────────────────────────
-- Porque son sesenta objetos por mil días: cuarenta mil velas que tendrían que
-- cruzar el cable para que el navegador las sumara. La suma se hace donde están
-- los datos y lo que viaja son los mil puntos de la curva.

-- ============================================================
-- La serie diaria
-- ============================================================
-- Devuelve un punto por día, de lo más viejo que se pueda a hoy, con el mismo
-- juego de columnas que `steam_portfolio_snapshots` — porque son la misma
-- pregunta contestada con dos precisiones, y la pantalla las dibuja igual.
--
-- `source` dice de dónde salió cada punto: 'snapshot' es la foto de verdad y
-- gana siempre que exista; 'reconstructed' es lo de arriba. Va en la fila y no
-- en un rótulo global para que quien lea esto desde fuera —o desde otra
-- pantalla mañana— no tenga que adivinarlo.
create or replace function public.rpc_steam_value_series(
  p_currency int default 3,
  p_days int default 1095
)
returns table (
  day            date,
  value_cents    bigint,
  item_count     bigint,
  distinct_items bigint,
  missing_prices bigint,
  source         text
)
language sql
security invoker
stable
as $$
with me as (
  select (select auth.uid()) as uid
),
-- Lo que tienes HOY. Es el ancla: se camina hacia atrás desde aquí.
today as (
  select h.appid, h.market_hash_name as name, h.quantity::bigint as qty
  from public.steam_holdings h, me
  where h.user_id = me.uid
),
-- Los movimientos que SÍ cambian cuántos tienes. `wallet_topup` y
-- `store_purchase` mueven dinero pero no objetos, y meterlos aquí desharía la
-- cuenta. Agrupados por día porque la vela es diaria: dos compras del mismo
-- objeto el mismo martes son un solo escalón.
moves as (
  select
    l.appid,
    l.market_hash_name as name,
    (l.happened_at at time zone 'UTC')::date as d,
    sum(case when l.kind = 'market_buy' then l.quantity else -l.quantity end)::bigint as delta
  from public.steam_ledger l, me
  where l.user_id = me.uid
    and l.appid is not null
    and l.market_hash_name is not null
    and l.kind in ('market_buy', 'market_sell')
  group by 1, 2, 3
),
-- El universo es la UNIÓN de las dos: lo que tienes hoy y lo que alguna vez
-- pasó por el libro. Con solo lo primero, un objeto que compraste y vendiste
-- desaparecería del pasado, y ahí sí estaba.
items as (
  select appid, name from today
  union
  select appid, name from moves
),
anchor as (
  select i.appid, i.name, coalesce(t.qty, 0) as qty_today
  from items i
  left join today t on t.appid = i.appid and t.name = i.name
),
-- Dónde empieza la curva. Lo más viejo que haya en el histórico de TUS objetos,
-- con un tope: `p_days` días. El tope no es cosmético — sin él, un cromo de 2013
-- estira la rejilla a cuatro mil días y multiplica el trabajo por cuatro para
-- dibujar un tramo en el que no tenías nada de esto.
--
-- Sin una sola vela guardada esto es null, y entonces `generate_series` no
-- devuelve ninguna fila: la función contesta vacío y la pantalla dice que hace
-- falta subir el histórico. Mejor eso que una línea plana en cero.
span as (
  select case
           when min(h.day) is null then null
           else greatest(min(h.day), current_date - greatest(1, least(p_days, 3650)))
         end as from_day
  from public.steam_price_history h
  join items i on i.appid = h.appid and i.name = h.market_hash_name
  where h.currency = p_currency
),
days as (
  select (span.from_day + s)::date as day
  from span, generate_series(0, current_date - span.from_day) as s
  where span.from_day is not null
),
-- El precio se ARRASTRA. Steam solo escribe vela los días que hubo ventas, así
-- que un objeto que no se mueve deja huecos de semanas; sin arrastrar, esos días
-- valdrían cero y la curva se llenaría de dientes que no ocurrieron.
--
-- `lead` da el día de la vela siguiente, y cada vela se estira hasta ahí. Se
-- hace así y no con una subconsulta por celda porque son cuarenta mil celdas:
-- esto es un barrido del índice, aquello son cuarenta mil búsquedas.
candles as (
  select
    h.appid,
    h.market_hash_name as name,
    h.day,
    h.median_cents,
    lead(h.day) over (partition by h.appid, h.market_hash_name order by h.day) as next_day
  from public.steam_price_history h
  join items i on i.appid = h.appid and i.name = h.market_hash_name
  where h.currency = p_currency
),
priced as (
  select c.appid, c.name, d.day, c.median_cents
  from candles c
  join days d on d.day >= c.day and (c.next_day is null or d.day < c.next_day)
),
-- Una celda por objeto y día: cuántos tenías y cuánto valía uno.
--
-- La cantidad de un día es la de hoy MENOS todo lo que entró después. Compraste
-- después → antes tenías menos; vendiste después → antes tenías más. Se escribe
-- como una resta de la cola y no como un bucle porque es lo mismo y se lee.
-- La misma regla, en cliente, está en app/src/domain/steamSeries.ts (`heldOn`),
-- que es la que tiene los tests.
cells as (
  select
    d.day,
    a.qty_today - coalesce((
      select sum(m.delta) from moves m
       where m.appid = a.appid and m.name = a.name and m.d > d.day
    ), 0) as qty,
    p.median_cents
  from anchor a
  cross join days d
  left join priced p on p.appid = a.appid and p.name = a.name and p.day = d.day
),
recon as (
  select
    c.day,
    coalesce(sum(c.qty * c.median_cents) filter (where c.qty > 0 and c.median_cents is not null), 0)::bigint as value_cents,
    coalesce(sum(c.qty) filter (where c.qty > 0), 0)::bigint as item_count,
    count(*) filter (where c.qty > 0)::bigint as distinct_items,
    -- Los que ese día tenías y no sabemos qué valían. Es la misma columna que la
    -- foto diaria, y sirve para lo mismo: distinguir un bache de la línea de una
    -- tanda de precios que no llegó.
    count(*) filter (where c.qty > 0 and c.median_cents is null)::bigint as missing_prices
  from cells c
  group by c.day
),
joined as (
  select
    r.day,
    coalesce(s.value_cents::bigint, r.value_cents)       as value_cents,
    coalesce(s.item_count::bigint, r.item_count)         as item_count,
    coalesce(s.distinct_items::bigint, r.distinct_items) as distinct_items,
    coalesce(s.missing_prices::bigint, r.missing_prices) as missing_prices,
    case when s.day is null then 'reconstructed' else 'snapshot' end as source
  from recon r
  left join public.steam_portfolio_snapshots s
    on s.user_id = (select auth.uid())
   and s.day = r.day
   and s.currency = p_currency
),
-- Los días de cabeza que valen cero se tiran. Pasa cuando el tope alcanza más
-- atrás que la primera vela de casi todo: la curva arrancaría con una rampa
-- desde cero que no es una caída del mercado, es que no hay datos. Se corta por
-- el primer día con valor y a partir de ahí se pinta todo, ceros incluidos.
first_value_day as (
  select min(day) as day from joined where value_cents > 0
)
select j.day, j.value_cents, j.item_count, j.distinct_items, j.missing_prices, j.source
from joined j, first_value_day f
where f.day is not null and j.day >= f.day
order by j.day
$$;

comment on function public.rpc_steam_value_series(int, int) is
  'Valor diario de la cartera del que llama, reconstruido hacia atras con steam_price_history y steam_ledger. source=snapshot son los dias con foto real; source=reconstructed es aproximado y lo que salio de cajas o drops se cuenta como si lo hubieras tenido siempre.';

grant execute on function public.rpc_steam_value_series(int, int) to authenticated;
