-- 0097_la_rejilla_trimestral_y_el_indice_cubriente.sql
--
-- 0096 no bastó. Con ella aplicada, la curva seguía tardando 8.161 ms en
-- producción —el `statement_timeout`— y la pantalla seguía diciendo «todavía no
-- hay gráfica». Lo que faltaba era medir DENTRO de producción en vez de en esta
-- máquina, y ahí el reparto es otro:
--
--   ventana       puntos   tiempo    buffers
--   trece años       169   3.958 ms  379.795
--   dos años          35     365 ms   79.434
--
-- El coste es lineal en PUNTOS DE LA REJILLA, y cada sondeo de precio cuesta
-- allí unos 10 µs contra 1 µs aquí: diez veces. Por eso 0096 —que en local baja
-- de 858 a 280 ms— allí seguía sin caber. Las dos cosas que hace este fichero
-- salen de esa medida, y las dos están medidas contra producción.
--
-- ── 1. Un punto por trimestre en los años viejos ──────────────────────────
-- La rejilla pasa a tener tres pasos en vez de dos:
--
--   · un punto por TRIMESTRE del principio del histórico hasta hace dos años;
--   · un punto por MES de ahí hasta hace seis;
--   · un punto cada DOS SEMANAS en los últimos seis meses, contados hacia atrás
--     desde hoy para que hoy sea siempre un punto;
--   · más los días con FOTO REAL, que se añaden enteros y aparte.
--
-- Medido en producción, con el mismo inventario y la misma función:
--
--   mensual desde 2013 (0096)     169 puntos   3.958 ms
--   trimestral en lo viejo         80 puntos   1.755 ms
--
-- 2,3× de margen, y el argumento es el mismo que usó 0095 para bajar de diario a
-- mensual: la tarjeta mide 900×150 px. Con trece años y 169 puntos son cinco
-- días por píxel; la resolución mensual de 2015 no se ve, y la de los últimos
-- seis meses —que es la que se mira— no se toca.
--
-- ── 2. El índice cubriente, que en local no medía nada ────────────────────
-- 0096 lo probó y lo descartó: los sondeos pasaban a `Index Only Scan` con
-- `Heap Fetches: 0` y el reloj no se movía ni un 2 %. Era verdad AQUÍ, donde el
-- montón está caliente. En producción cada sondeo que evita el montón es una
-- página menos, y la llamada pasó de 8.161 a 6.535 ms en cuanto se creó.
--
-- Cuesta 55 MB sobre una tabla de 66 MB, y esa es la contrapartida entera.
--
-- ⚠️ Este índice YA ESTÁ en producción: se creó a mano el 30-08-2026 para poder
-- medirlo, antes de existir este fichero. El `if not exists` es lo que hace que
-- esta migración sea cierta en los dos sitios —allí no hace nada, en una base
-- nueva lo crea— y esta nota es para que nadie se extrañe de verlo en un
-- `\d steam_price_history` de producción con una migración que parece posterior.
--
-- ── Lo que NO cambia ──────────────────────────────────────────────────────
-- Las columnas, las reglas (cuántos tenías tal día, el arrastre del precio, la
-- foto que manda), `p_days`, y todo lo que 0096 reescribió por dentro: los
-- tramos de cantidad constante y el mínimo con la clave siguen igual. Lo único
-- que cambia de la función es dónde caen los puntos.
--
-- La matriz de 0092 pasa entera y sin tocarla: prueba reglas, no rejilla. La de
-- 0095 sí se ha tenido que actualizar —era la que decía «mensual atrás»— y
-- ahora comprueba los tres pasos.

-- El índice cubriente: la misma clave que la primaria más `median_cents`, para
-- que el sondeo de «la última vela hasta este día» no toque el montón.
create index if not exists steam_price_history_cubriente
  on public.steam_price_history (appid, market_hash_name, currency, day desc)
  include (median_cents);

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
today as (
  select h.appid, h.market_hash_name as name, h.quantity::bigint as qty
  from public.steam_holdings h, me
  where h.user_id = me.uid
),
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
steps as (
  select i.iid, m.d, m.delta
  from moves m
  join items i on i.appid = m.appid and i.name = m.name
),
-- CAMBIO 1: el día más viejo, con la clave y no con la tabla entera.
span as (
  select
    s.from_day,
    -- Los últimos seis meses, quincenales; los dos últimos años, mensuales; y de
    -- ahí para atrás, trimestrales. Los `greatest` son para quien tenga poco
    -- histórico: sin ellos, una frontera podría caer antes de su primer día y el
    -- `generate_series` del tramo de en medio saldría al revés.
    greatest(s.from_day, current_date - 730) as grueso_hasta,
    greatest(s.from_day, current_date - 183) as fino_desde
  from (
    select case
             when x.m0 is null then null
             when p_days is null then x.m0
             else greatest(x.m0, current_date - greatest(1, least(p_days, 3650)))
           end as from_day
    from (
      select min(v.m) as m0
      from items i
      cross join lateral (
        select min(h.day) as m
        from public.steam_price_history h
        where h.appid = i.appid
          and h.market_hash_name = i.name
          and h.currency = p_currency
      ) v
    ) x
  ) s
),
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
rejilla as (
  select (date_trunc('quarter', g)::date) as day
  from span, generate_series(
         date_trunc('quarter', span.from_day::timestamp),
         date_trunc('quarter', (span.grueso_hasta - 1)::timestamp),
         interval '3 month') g
  where span.from_day is not null
    and date_trunc('quarter', g)::date >= span.from_day
  union
  select (date_trunc('month', g)::date) as day
  from span, generate_series(
         date_trunc('month', span.grueso_hasta::timestamp),
         date_trunc('month', (span.fino_desde - 1)::timestamp),
         interval '1 month') g
  where span.from_day is not null
    and date_trunc('month', g)::date >= span.grueso_hasta
  union
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
-- CAMBIO 2: tramos de cantidad constante en vez de una celda por objeto y día.
--
-- Los extremos van con `infinity` y `-infinity` y no con nulos: el cruce con la
-- rejilla es la comparación que más veces se hace de toda la función —7.497
-- tramos por 173 puntos— y con nulos eran cuatro ramas por comparación en vez de
-- dos. No mueve el reloj (medido: 277-288 ms contra 272-315), pero dice una vez
-- al construir el tramo lo que si no habría que volver a preguntar en cada
-- comparación: que un tramo sin siguiente movimiento llega hasta hoy, y que el
-- primero viene de siempre.
resumen as (
  select iid, min(d) as primer_dia, sum(delta) as total
  from steps
  group by iid
),
tramos as (
  select
    a.appid, a.name,
    k.d as desde,
    coalesce(lead(k.d) over (partition by k.iid order by k.d), 'infinity'::date) as hasta,
    a.qty_today - coalesce(
      sum(k.delta) over (partition by k.iid order by k.d desc
                         rows between unbounded preceding and 1 preceding), 0) as qty
  from steps k
  join anchor a on a.iid = k.iid
  union all
  select
    a.appid, a.name,
    '-infinity'::date as desde,
    coalesce(r.primer_dia, 'infinity'::date) as hasta,
    a.qty_today - coalesce(r.total, 0) as qty
  from anchor a
  left join resumen r on r.iid = a.iid
),
celdas as (
  select d.day, t.qty, v.median_cents
  from tramos t
  join days d
    on d.day >= t.desde and d.day < t.hasta
  left join lateral (
    select h.median_cents
    from public.steam_price_history h
    where h.appid = t.appid
      and h.market_hash_name = t.name
      and h.currency = p_currency
      and h.day <= d.day
    order by h.day desc
    limit 1
  ) v on true
  where t.qty > 0
),
por_dia as (
  select
    c.day,
    coalesce(sum(c.qty * c.median_cents) filter (where c.median_cents is not null), 0)::bigint as value_cents,
    sum(c.qty)::bigint                                                                         as item_count,
    count(*)::bigint                                                                           as distinct_items,
    count(*) filter (where c.median_cents is null)::bigint                                     as missing_prices
  from celdas c
  group by c.day
),
recon as (
  select
    d.day,
    coalesce(p.value_cents, 0)    as value_cents,
    coalesce(p.item_count, 0)     as item_count,
    coalesce(p.distinct_items, 0) as distinct_items,
    coalesce(p.missing_prices, 0) as missing_prices
  from days d
  left join por_dia p on p.day = d.day
),
joined as (
  select day, value_cents, item_count, distinct_items, missing_prices, 'reconstructed'::text as source
  from recon
  union all
  select day, value_cents, item_count, distinct_items, missing_prices, 'snapshot'::text
  from fotos
),
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

comment on function public.rpc_steam_value_series(int, int) is
  'Valor de la cartera del que llama, reconstruido hacia atras con steam_price_history y steam_ledger. Llega hasta la vela mas vieja que haya (p_days lo acorta). Un punto por trimestre hasta hace dos anos, por mes hasta hace seis, quincenal en los ultimos seis meses, mas todos los dias con foto real: el eje se dibuja por FECHA y no por posicion. source=snapshot son las fotos; source=reconstructed es aproximado y lo que salio de cajas o drops se cuenta como si lo hubieras tenido siempre.';

grant execute on function public.rpc_steam_value_series(int, int) to authenticated;
