-- 0095_la_curva_por_meses.sql
--
-- La curva de la cartera dejaba de dibujarse en producción. Esto la devuelve, y
-- de paso le quita el techo que la iba a volver a tirar dentro de unos meses.
--
-- ── Lo que pasó ───────────────────────────────────────────────────────────
-- Medido contra producción el 30-08-2026, con 608 objetos y 339 de ellos con
-- histórico desde 2013:
--
--   ventana        puntos   tiempo
--   730 días          731   5,09 s
--   1.095             784   5,64 s
--   1.825             888   6,23 s
--   2.555             992   7,17 s
--   todo (2013)         —   57014: statement timeout a los 8,6 s
--
-- La pantalla no enseñaba un error: enseñaba «todavía no hay gráfica, sube el
-- histórico», que es el mensaje de cuando la serie viene vacía. Una avería
-- disfrazada de falta de datos.
--
-- Y lo que se llevaba el presupuesto NO era el tramo largo que abrió 0094 —cada
-- 730 días de más costaban 0,6 s— sino los CINCO SEGUNDOS FIJOS del tramo
-- diario de dos años. Eso venía de haber pasado de 60 objetos con histórico a
-- 339 (el recolector ya no tiene tope), y crecía con cada volcado. Revertir 0094
-- entero habría dejado 5 s de los 8 y subiendo: no era un arreglo, era esperar.
--
-- ── Qué se hace ───────────────────────────────────────────────────────────
-- Se deja de pintar un punto por día. La tarjeta mide 900×150 px: con trece años
-- de curva son seis días por píxel, así que la resolución diaria no se ve. La
-- rejilla pasa a ser, por decisión del usuario (30-08-2026):
--
--   · un punto por MES, del principio del histórico hasta hace seis meses;
--   · un punto cada DOS SEMANAS en los últimos seis meses, contados hacia atrás
--     desde hoy para que hoy sea siempre un punto;
--   · más los días que tengan FOTO REAL, que se añaden enteros y aparte.
--
-- Unos 170 puntos en vez de 4.855, y —esto es lo que quita el techo— el número
-- ya no depende de lo atrás que llegue el histórico: trece años y veinte cuestan
-- casi lo mismo.
--
-- ── El otro cambio: cómo se busca el precio ───────────────────────────────
-- Con la rejilla pequeña cambia cuál es la forma barata de buscarlo.
--
-- 0092 no podía juntar la rejilla con las velas —eran 456.000 velas contra 760
-- días y el planificador materializaba 348 millones de filas—, así que estiraba
-- cada vela sobre los días que cubría. Esa cuenta escala con los DÍAS: con la
-- rejilla de 0094 son 339 objetos × 4.855.
--
-- Con ~170 puntos ya no hace falta. Se recorre la rejilla —608 objetos × 170
-- puntos, unas 98.000 celdas— y para cada una se pregunta «¿cuál fue la última
-- vela de este objeto hasta este día?» con un `order by day desc limit 1`, que
-- es un salto sobre la clave primaria de `steam_price_history` (appid,
-- market_hash_name, currency, day). Trabajo acotado y proporcional a los PUNTOS,
-- no a los días.
--
-- El arrastre del precio sigue siendo el mismo y por el mismo motivo: Steam solo
-- escribe vela los días que hubo ventas, así que la última vale hasta la
-- siguiente. Antes se decía estirando; ahora se dice preguntando.
--
-- ── Medido, porque las dos primeras versiones de esto fueron peores ───────
-- Con el inventario real reproducido en local (608 objetos, 339 con histórico
-- desde 2013, 262.725 velas, 12.000 movimientos):
--
--   0094, un punto por día                          1.291 puntos   3,3 s
--   0095 con el precio dentro del `group by`          161 puntos   3,8 s
--   0095 con la cantidad en un subselect por celda    161 puntos  78,9 s
--   0095 como está aquí                               161 puntos   0,7 s
--
-- Las dos versiones malas están contadas en el comentario de `cantidades`,
-- porque el porqué de que este paso vaya suelto no se ve leyéndolo.
--
-- ── Y las fotos reales ya no se reconstruyen para tirarlas ────────────────
-- `steam_portfolio_snapshots` gana siempre que exista, así que reconstruir esos
-- días era trabajo para la basura. Ahora la rejilla los excluye y las fotos se
-- añaden al final con una lectura de tabla. Cuestan lo que cuesta leerlas, y por
-- eso se devuelven TODAS aunque no caigan en la rejilla: son exactas y son
-- gratis. El día que haya tres años de fotos, la cola reciente de la curva será
-- densa y de verdad, que es justo donde interesa.
--
-- ── Lo que NO cambia ──────────────────────────────────────────────────────
-- Las columnas, la regla de cuántos tenías tal día (`heldOn` en
-- app/src/domain/steamSeries.ts, con su matriz en vitest), el reparto
-- snapshot/reconstructed, la advertencia de que lo que salió de una caja se
-- cuenta como si lo hubieras tenido siempre, y `p_days` como salida de
-- emergencia. Las comprobaciones de 0092 siguen valiendo enteras.
--
-- La ficha de un objeto suelto tampoco se toca: esa lee `steam_price_history`
-- directamente y sigue enseñando la vela diaria que trajo el recolector.

create or replace function public.rpc_steam_value_series(
  p_currency int default 3,
  p_days int default null
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
-- cuenta. Agrupados por día porque un punto de la curva es un corte en el
-- tiempo: dos compras del mismo objeto el mismo martes son un solo escalón.
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
  select u.appid, u.name, row_number() over (order by u.appid, u.name) as iid
  from (
    select appid, name from today
    union
    select appid, name from moves
  ) u
),
anchor as (
  select i.iid, i.appid, i.name, coalesce(t.qty, 0) as qty_today
  from items i
  left join today t on t.appid = i.appid and t.name = i.name
),
-- Los movimientos, ya numerados. Son decenas de filas: cabe en cualquier sitio.
steps as (
  select i.iid, m.d, m.delta
  from moves m
  join items i on i.appid = m.appid and i.name = m.name
),
-- Dónde empieza la curva y dónde cambia de paso.
--
-- Empieza en lo más viejo que haya en el histórico de TUS objetos. Sin tope,
-- porque desde 0095 el tope ya no hace falta: la rejilla no crece con los años.
-- `p_days` sigue estando para quien quiera menos.
span as (
  select
    s.from_day,
    -- Los últimos seis meses van más finos. `greatest` para que a quien tenga
    -- dos semanas de histórico no le salga una frontera anterior a su primer día.
    greatest(s.from_day, current_date - 183) as fino_desde
  from (
    select case
             when min(h.day) is null then null
             when p_days is null then min(h.day)
             else greatest(min(h.day), current_date - greatest(1, least(p_days, 3650)))
           end as from_day
    from public.steam_price_history h
    join items i on i.appid = h.appid and i.name = h.market_hash_name
    where h.currency = p_currency
  ) s
),
-- Las fotos de verdad. Se leen aparte y mandan: por eso se sacan de la rejilla
-- —reconstruir un día que va a perder es trabajo tirado— y se pegan al final.
fotos as (
  select s.day, s.value_cents::bigint, s.item_count::bigint, s.distinct_items::bigint,
         s.missing_prices::bigint
  from public.steam_portfolio_snapshots s, me, span
  where s.user_id = me.uid
    and s.currency = p_currency
    and span.from_day is not null
    and s.day >= span.from_day
    and s.day <= current_date
),
-- La rejilla: mensual atrás, quincenal en los últimos seis meses, y siempre el
-- primer día y hoy. `union` y no `union all` porque los extremos pueden caer
-- encima de un punto que ya está.
rejilla as (
  select (date_trunc('month', g)::date) as day
  from span, generate_series(
         date_trunc('month', span.from_day::timestamp),
         date_trunc('month', (span.fino_desde - 1)::timestamp),
         interval '1 month') g
  where span.from_day is not null
    and date_trunc('month', g)::date >= span.from_day
  union
  -- Hacia atrás desde hoy, para que hoy sea siempre un punto de la curva.
  select (current_date - s)::date
  from span, generate_series(0, current_date - span.fino_desde, 14) as s
  where span.from_day is not null
  union
  select span.from_day from span where span.from_day is not null
),
days as (
  select r.day from rejilla r
  where not exists (select 1 from fotos f where f.day = r.day)
),
-- Cuántos tenías de cada objeto en cada punto de la rejilla. 608 × ~170
-- celdas, y ni una más.
--
-- ── Por qué esto va en su propio paso y no junto al precio ────────────────
-- Porque juntarlos multiplicaba el trabajo por veinte. El primer intento hacía
-- `cross join anchor left join steps` y buscaba el precio en el mismo `select`:
-- el `left join steps` convierte cada celda en UNA FILA POR MOVIMIENTO de ese
-- objeto —12.581 filas por punto en vez de 608— y el lateral del precio se
-- ejecutaba una vez por fila explotada. Medido con el inventario real:
-- 2.025.541 saltos de índice en lugar de 98.000, y la función tardaba más que
-- la versión de 0094 que venía a arreglar.
--
-- La cantidad es la de hoy MENOS todo lo que entró después. Compraste después →
-- antes tenías menos; vendiste después → antes tenías más. La misma regla, en
-- cliente, está en app/src/domain/steamSeries.ts (`heldOn`), que es la que tiene
-- los tests.
cantidades as (
  select
    d.day,
    a.appid,
    a.name,
    a.qty_today - coalesce(sum(s.delta) filter (where s.d > d.day), 0) as qty
  from days d
  cross join anchor a
  left join steps s on s.iid = a.iid
  group by d.day, a.iid, a.appid, a.name, a.qty_today
),
-- Y ahora el precio, UNA vez por celda y solo de lo que ese día tenías.
--
-- El `limit 1` es la vela que manda: la última hasta esa fecha, que es el
-- arrastre de siempre —Steam solo escribe vela los días que hubo ventas— y sale
-- de un salto sobre la clave primaria de `steam_price_history`. Sin vela
-- todavía, el lateral no devuelve fila y la celda cuenta como precio que falta,
-- que es lo que dice la columna `missing_prices`.
--
-- El `qty > 0` va aquí y no después a propósito: preguntar el precio de algo que
-- ese día no tenías es trabajo que no se usa para nada, y son la mayoría de las
-- celdas de los años viejos.
celdas as (
  select c.day, c.qty, v.median_cents
  from cantidades c
  left join lateral (
    select h.median_cents
    from public.steam_price_history h
    where h.appid = c.appid
      and h.market_hash_name = c.name
      and h.currency = p_currency
      and h.day <= c.day
    order by h.day desc
    limit 1
  ) v on true
  where c.qty > 0
),
recon as (
  select
    d.day,
    coalesce(sum(c.qty * c.median_cents) filter (where c.median_cents is not null), 0)::bigint as value_cents,
    coalesce(sum(c.qty), 0)::bigint                                                            as item_count,
    count(c.qty)::bigint                                                                       as distinct_items,
    count(*) filter (where c.qty is not null and c.median_cents is null)::bigint                as missing_prices
  from days d
  left join celdas c on c.day = d.day
  group by d.day
),
joined as (
  select day, value_cents, item_count, distinct_items, missing_prices, 'reconstructed'::text as source
  from recon
  union all
  select day, value_cents, item_count, distinct_items, missing_prices, 'snapshot'::text
  from fotos
),
-- Los puntos de cabeza que valen cero se tiran: pasa cuando el primer día del
-- histórico es de un objeto que entonces no tenías, y la curva arrancaría con
-- una rampa desde cero que no es una caída del mercado, es que no hay datos.
first_value_day as (
  select min(day) as day from joined where value_cents > 0
)
select j.day, j.value_cents, j.item_count, j.distinct_items, j.missing_prices, j.source
from joined j, first_value_day f
where f.day is not null and j.day >= f.day
order by j.day
$$;

comment on function public.rpc_steam_value_series(int, int) is
  'Valor de la cartera del que llama, reconstruido hacia atras con steam_price_history y steam_ledger. Llega hasta la vela mas vieja que haya (p_days lo acorta). Un punto por mes, quincenal en los ultimos seis meses, mas todos los dias con foto real: el eje se dibuja por FECHA y no por posicion. source=snapshot son las fotos; source=reconstructed es aproximado y lo que salio de cajas o drops se cuenta como si lo hubieras tenido siempre.';

grant execute on function public.rpc_steam_value_series(int, int) to authenticated;
