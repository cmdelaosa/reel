-- Banco de pruebas del filtro por medio (0099), con la forma de la biblioteca
-- de producción: ~2.100 títulos repartidos 1.300 cine / 410 series / 390
-- juegos, 46.790 episodios y 34.000 visionados. Todo dentro de una transacción
-- que acaba en rollback.
--
-- ESTO NO ES UNA MATRIZ: no afirma nada, MIDE. La matriz del rollup es
-- 0098_rollup_sin_laterales.sql, y es la que tiene que pasar. Esto se corre a
-- mano el día que alguien vuelva a tocar la función y quiera saber qué le pasa
-- al reparto por medio, que es el número que justificó 0099:
--
--   supabase db reset
--   docker cp supabase/sql-checks/0099_banco_del_filtro_por_medio.sql supabase_db_tvtime:/tmp/b.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/b.sql
--
-- ⚠️ Y LOS TIEMPOS DE AQUÍ NO SON UNA MEDIDA DE PRODUCCIÓN. En esta pila la
-- misma consulta ha dado entre 8 y 174 ms según lo que estuviera haciendo el
-- Docker de al lado: sirven para comparar los cuatro medios en la MISMA vuelta,
-- no para llevarse un número. Lo que sí es estable —y lo que de verdad decidió
-- el cambio— es la última consulta: cuántas filas devuelve cada medio, que es
-- lo que fija cuántas ventanas de mil pide el cliente.
--
-- Los tmdb_id son 8000xx-8200xx, marcados a propósito, por si algún día alguien
-- se deja el rollback: un número alto NO es un rango seguro.
--
-- ⚠️ Las columnas que salen de los agregados TIENEN que leerse: un
-- `count(*) from (…) x` deja que el planificador quite los joins y no mide
-- nada. Es la trampa que documenta 0098, y aquí se evita sumando aired_count,
-- watched_count y contando las fechas.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0099-0099-0099-aaaaaaaaaaaa', 'medir-0099@example.com')
on conflict (id) do nothing;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0099-0099-0099-aaaaaaaaaaaa","role":"authenticated"}', true);

insert into public.titles (tmdb_id, kind, name, first_air_date)
select 800000 + g, 'tv', 'serie ' || g, (now() - interval '3 years')::date
from generate_series(1, 410) g;
insert into public.titles (tmdb_id, kind, name, first_air_date)
select 810000 + g, 'movie', 'peli ' || g, (now() - interval '2 years')::date
from generate_series(1, 1300) g;
insert into public.titles (tmdb_id, kind, name, first_air_date)
select 820000 + g, 'game', 'juego ' || g, (now() - interval '1 year')::date
from generate_series(1, 390) g;

-- 110 episodios por serie = 45.100.
insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1 + (n / 20), 1 + (n % 20), now() - ((150 - n) || ' days')::interval
from public.titles t, generate_series(0, 109) n
where t.kind = 'tv' and t.tmdb_id between 800001 and 800410;

insert into public.library_entries (user_id, title_id, followed)
select 'aaaaaaaa-0099-0099-0099-aaaaaaaaaaaa', t.id, true
from public.titles t where t.tmdb_id >= 800000;

-- 34.000 visionados, sobre los episodios emitidos de las series.
insert into public.watch_events (user_id, episode_id, watched_at)
select 'aaaaaaaa-0099-0099-0099-aaaaaaaaaaaa', e.id, now() - interval '100 days'
from (
  select e.id from public.episodes e
  join public.titles t on t.id = e.title_id
  where t.kind = 'tv' and t.tmdb_id between 800001 and 800410
    and e.air_datetime <= now()
  limit 34000
) e;

analyze public.titles;
analyze public.episodes;
analyze public.watch_events;
analyze public.library_entries;

select (select count(*) from public.library_entries where user_id = 'aaaaaaaa-0099-0099-0099-aaaaaaaaaaaa') as biblioteca,
       (select count(*) from public.episodes) as episodios,
       (select count(*) from public.watch_events) as visionados;

\echo '--- p_kind null: la biblioteca entera, que es lo que se pedia hasta hoy'
explain (analyze, timing off, summary on, costs off)
select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)
     + count(r.last_aired_datetime) + count(r.next_air_datetime)
from public.rpc_library_rollup(null) r;

\echo '--- p_kind movie: lo que pide /movies'
explain (analyze, timing off, summary on, costs off)
select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)
     + count(r.last_aired_datetime) + count(r.next_air_datetime)
from public.rpc_library_rollup('movie') r;

\echo '--- p_kind game: lo que pide /games'
explain (analyze, timing off, summary on, costs off)
select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)
     + count(r.last_aired_datetime) + count(r.next_air_datetime)
from public.rpc_library_rollup('game') r;

\echo '--- p_kind tv: lo que pide /shows, y el medio que NO se ahorra nada'
explain (analyze, timing off, summary on, costs off)
select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)
     + count(r.last_aired_datetime) + count(r.next_air_datetime)
from public.rpc_library_rollup('tv') r;

\echo '--- y las filas que devuelve cada uno, que es lo que decide las ventanas'
select coalesce(r.kind, 'TOTAL') as medio, count(*) as filas
from public.rpc_library_rollup(null) r group by rollup (r.kind) order by 1;

rollback;
