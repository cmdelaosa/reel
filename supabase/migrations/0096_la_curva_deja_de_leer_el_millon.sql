-- 0096_la_curva_deja_de_leer_el_millon.sql
--
-- La curva de la cartera volvió a caerse en producción, y esta vez la tiró el
-- arreglo del día anterior: desde la PR #122 el recolector trae también el
-- histórico de lo que vendiste, y `steam_price_history` pasó de ~456.000 velas a
-- ~1.036.000. Medido en el navegador el 30-08-2026, tres veces seguidas:
--
--   llamada a rpc_steam_value_series   8.206 ms · 8.483 ms · cuerpo vacío
--
-- Eso es el `statement_timeout` de ocho segundos, y la pantalla lo enseñaba
-- —otra vez— como «todavía no hay gráfica: la dibuja el histórico de precios».
-- La misma avería disfrazada que 0095 vino a arreglar, por una causa distinta.
--
-- ── Dónde se iba el tiempo ────────────────────────────────────────────────
-- Reproducido en local con el volcado REAL de ese día (608 objetos en el
-- inventario, 12.026 movimientos, 854.664 velas de 1.440 objetos), la función de
-- 0095 tardaba 588-858 ms aquí. La misma consulta tarda 8,2 s en producción: el
-- servidor de allí es del orden de diez veces más lento que esta máquina, que es
-- la misma proporción que ya midió 0095 (0,7 s aquí, 5,09 s allí). Con eso, el
-- `explain (analyze)` reparte así los 858 ms:
--
--   span         210 ms   min(day) del histórico
--   cantidades   447 ms   una celda por objeto y punto de la rejilla
--   precio       215 ms   la última vela de cada celda
--
-- Y los dos primeros estaban mal por motivos distintos:
--
-- **`span` leía la tabla entera para sacar un mínimo.** Hacía un `hash join` de
-- las 854.664 velas contra los 1.655 objetos para quedarse con `min(day)`. Ese
-- gasto no depende de tu cartera: crece con el histórico acumulado, así que
-- empeoraba solo, cada noche, con cada vela que escribe el cron. Es EL término
-- que iba a volver a romper esto dentro de unos meses aunque hoy se recortara
-- por otro lado.
--
-- **`cantidades` expandía cada celda por cada movimiento.** El `cross join
-- anchor left join steps` convertía 286.315 celdas en 1.375.004 filas —una por
-- movimiento de ese objeto— para agregarlas de vuelta con un `group by`. 0095 ya
-- había visto media avería aquí (por eso sacó el precio a un paso aparte) pero
-- dejó la expansión en pie.
--
-- ── Qué se hace ───────────────────────────────────────────────────────────
-- **El mínimo, con la clave.** Un `min(day)` por objeto con un lateral sobre
-- `steam_price_history (appid, market_hash_name, currency, day)` y el mínimo de
-- esos mínimos: 1.655 saltos de índice. 210 ms → 21 ms, y —esto es lo que
-- importa— ya no crece con el tamaño de la tabla, solo con tus objetos.
--
-- **Tramos en vez de celdas.** La cantidad de un objeto solo cambia los días que
-- lo moviste, así que en vez de preguntar «cuántos tenía» punto por punto se
-- calculan los TRAMOS de cantidad constante —entre movimiento y movimiento— con
-- una ventana, y se cruzan con la rejilla. Son 7.497 tramos en lugar de 1.375.004
-- filas, y el filtro `qty > 0` se aplica ANTES de expandir, que es lo que quita
-- el trabajo de verdad: de los 7.497 tramos solo 6.042 tienen existencias.
--
-- La regla no cambia ni un ápice, y sigue siendo la de `heldOn` en
-- app/src/domain/steamSeries.ts: la cantidad de hoy menos todo lo que entró
-- después, y el movimiento del propio día ya cuenta. Lo que cambia es cuándo se
-- calcula.
--
-- ── Medido ────────────────────────────────────────────────────────────────
-- Con el volcado real del 30-08-2026 en una base aparte, misma máquina:
--
--   0095    588-858 ms      (en producción: 8,2 s, o sea timeout)
--   0096    272-315 ms
--
-- Poco más del doble en el reloj, pero el reparto es otro: de los ~280 ms que
-- quedan, 168 son los sondeos de precio y 79 el cruce de tramos con la rejilla,
-- y los dos escalan con PUNTOS × OBJETOS QUE TENÍAS, no con velas acumuladas.
-- El histórico puede doblarse otra vez sin que esto se mueva.
--
-- Y devuelve exactamente lo mismo. Comprobado fila a fila contra la versión de
-- 0095 —`except` en los dos sentidos, cero diferencias— con el inventario real y
-- con un escenario de bordes: un drop que nunca pasó por el libro, uno comprado
-- y vendido entero, uno que sube y baja, dos movimientos el mismo día, y uno con
-- más ventas que compras (lo que salió de cajas), más una foto real de por
-- medio. La comparación sabe fallar: metiéndole a `tramos` el fallo de contar el
-- movimiento del propio día como posterior, salen 312 filas distintas.
--
-- ── Lo que se probó y NO está aquí ────────────────────────────────────────
-- Un índice cubriente `(appid, market_hash_name, currency, day desc) include
-- (median_cents)` para que el sondeo del precio no toque el montón. Funciona
-- —los sondeos pasan a `Index Only Scan` con `Heap Fetches: 0`— y no cambia el
-- reloj ni un 2 %: el montón ya estaba en caché. Son 55 MB de índice a cambio de
-- nada medible, así que fuera.
--
-- ── Lo que NO cambia ──────────────────────────────────────────────────────
-- Las columnas, la rejilla (mensual, quincenal en los últimos seis meses, más
-- los días con foto real), el reparto snapshot/reconstruido, `p_days` como salida
-- de emergencia, y la advertencia de que lo que salió de una caja se cuenta como
-- si lo hubieras tenido siempre. Las comprobaciones de 0092 y de 0095 siguen
-- valiendo enteras y son la matriz de esta migración: se pasaron las dos.

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
  select (date_trunc('month', g)::date) as day
  from span, generate_series(
         date_trunc('month', span.from_day::timestamp),
         date_trunc('month', (span.fino_desde - 1)::timestamp),
         interval '1 month') g
  where span.from_day is not null
    and date_trunc('month', g)::date >= span.from_day
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
