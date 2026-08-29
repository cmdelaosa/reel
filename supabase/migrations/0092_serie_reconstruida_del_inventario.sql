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
-- A cada objeto se le pone un número, `iid`, y de aquí en adelante TODO se junta
-- por él. No es cosmético. El par (appid, market_hash_name) es un entero y un
-- texto de hasta cincuenta caracteres —"Sticker | Natus Vincere (Holo) |
-- Katowice 2019"—, y juntar cuatrocientas mil filas por esa pareja es lo que
-- convertía el plan en un merge join con 348 MILLONES de filas materializadas:
-- 31 de los 38 segundos que tardaba, medido el 29-08-2026 con un inventario del
-- tamaño del real.
items as (
  select u.appid, u.name, row_number() over (order by u.appid, u.name) as iid
  from (
    select appid, name from today
    union
    select appid, name from moves
  ) u
),
anchor as (
  select i.iid, coalesce(t.qty, 0) as qty_today
  from items i
  left join today t on t.appid = i.appid and t.name = i.name
),
-- Los movimientos, ya numerados. Son decenas de filas: cabe en cualquier sitio.
steps as (
  select i.iid, m.d, m.delta
  from moves m
  join items i on i.appid = m.appid and i.name = m.name
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
-- `lead` da el día de la vela siguiente, y cada vela vale desde el suyo hasta la
-- víspera de esa — o hasta hoy, si es la última.
candles as (
  select
    i.iid,
    h.day,
    h.median_cents,
    lead(h.day) over (partition by i.iid order by h.day) as next_day
  from public.steam_price_history h
  join items i on i.appid = h.appid and i.name = h.market_hash_name
  where h.currency = p_currency
    and h.day <= current_date
),
-- Cada vela se ESTIRA sobre los días que cubre, en vez de juntarla con la lista
-- de días por rango.
--
-- La diferencia importa: un `join days d on d.day >= c.day and d.day <
-- c.next_day` es una condición de rango, y el planificador la resuelve
-- comparando cada vela con cada día. Con 456.000 velas y 760 días eso son
-- cientos de millones de comparaciones. Estirando, cada vela produce
-- exactamente los días que dura y no se compara con nada: el total de filas es
-- el mismo, el trabajo no.
--
-- El recorte a la ventana va DENTRO del `generate_series`: una vela anterior a
-- `from_day` cuyo tramo entra en la ventana la cubre desde el borde, y una que
-- se queda entera fuera devuelve cero filas y no cuesta nada.
priced as (
  select c.iid, (c.day + s)::date as day, c.median_cents
  from candles c
  cross join span
  cross join lateral generate_series(
    greatest(0, span.from_day - c.day),
    least(coalesce(c.next_day - 1, current_date), current_date) - c.day
  ) as s
  where span.from_day is not null
),
-- Desde qué día tiene precio cada objeto, dentro de la ventana.
--
-- La cobertura de un objeto es un TRAMO SEGUIDO: cada vela llega hasta la
-- víspera de la siguiente y la última hasta hoy, así que en cuanto hay una
-- primera vela ya no vuelve a faltar precio. Eso es lo que permite contar los
-- objetos sin precio de un día sin volver a juntar la rejilla entera con
-- `priced`: basta con comparar el día contra esta fecha.
cover as (
  select c.iid, greatest(min(c.day), span.from_day) as from_day
  from candles c
  cross join span
  group by c.iid, span.from_day
),
-- Cuántos tenías de cada objeto cada día.
--
-- ── Por qué esto no es una rejilla con un `left join` ─────────────────────
-- Porque la rejilla —todos los objetos × todos los días, juntada después con los
-- precios— tardaba 38 segundos con el inventario del usuario (600 objetos,
-- 456.000 velas), medido el 29-08-2026. La pantalla no habría enseñado la curva
-- NUNCA: el `statement_timeout` de PostgREST corta mucho antes, y el fallo
-- habría sido un 57014 en producción y nada en desarrollo, donde con cuatro
-- objetos de prueba tardaba 48 ms.
--
-- Así que la rejilla no se construye. Se recorren las filas de `priced`, que ya
-- son una por objeto y día CON precio, y a cada una se le cuelga su cantidad. Y
-- los días sin precio de un objeto —que son los que faltarían— se sacan aparte
-- comparando contra `cover`, sin volver a juntar nada grande.
--
-- La cantidad de un día es la de hoy MENOS todo lo que entró después. Compraste
-- después → antes tenías menos; vendiste después → antes tenías más. La misma
-- regla, en cliente, está en app/src/domain/steamSeries.ts (`heldOn`), que es la
-- que tiene los tests; y las dos direcciones están afirmadas en
-- supabase/sql-checks/0092_serie_reconstruida.sql.
priced_cells as (
  select
    p.day,
    p.median_cents,
    a.qty_today - coalesce(sum(s.delta) filter (where s.d > p.day), 0) as qty
  from priced p
  join anchor a on a.iid = p.iid
  left join steps s on s.iid = p.iid
  group by p.day, p.iid, p.median_cents, a.qty_today
),
-- Lo que ese día tenías y no sabemos qué valía: o no tiene ni una vela, o las
-- suyas empiezan después. Son pocos, y por eso salen baratos.
unpriced_cells as (
  select
    d.day,
    a.qty_today - coalesce(sum(s.delta) filter (where s.d > d.day), 0) as qty
  from anchor a
  cross join days d
  left join cover c on c.iid = a.iid
  left join steps s on s.iid = a.iid
  where c.iid is null or d.day < c.from_day
  group by d.day, a.iid, a.qty_today
),
-- Los dos montones, sumados día a día. Se parte de `days` y no de los montones
-- para que la serie no se salte un día en el que no hubiera ni una cosa ni la
-- otra: un hueco en el eje se lee como una caída y no lo es.
recon as (
  select
    d.day,
    coalesce(sum(parts.value_cents), 0)::bigint    as value_cents,
    coalesce(sum(parts.units), 0)::bigint          as item_count,
    coalesce(sum(parts.names), 0)::bigint          as distinct_items,
    -- La misma columna que la foto diaria, y sirve para lo mismo: distinguir un
    -- bache de la línea de una tanda de precios que no llegó.
    coalesce(sum(parts.missing), 0)::bigint        as missing_prices
  from days d
  left join (
    select
      p.day,
      sum(p.qty * p.median_cents) filter (where p.qty > 0)::bigint as value_cents,
      sum(p.qty) filter (where p.qty > 0)::bigint                  as units,
      count(*) filter (where p.qty > 0)::bigint                    as names,
      0::bigint                                                    as missing
    from priced_cells p
    group by p.day
    union all
    select
      u.day,
      0::bigint,
      sum(u.qty) filter (where u.qty > 0)::bigint,
      count(*) filter (where u.qty > 0)::bigint,
      count(*) filter (where u.qty > 0)::bigint
    from unpriced_cells u
    group by u.day
  ) parts on parts.day = d.day
  group by d.day
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
