-- Banco de 0100, con la forma de la biblioteca de producción: 2.100 títulos
-- (1.300 cine / 410 series / 390 juegos), 45.100 episodios y 34.000
-- visionados. Todo dentro de una transacción que acaba en rollback.
--
-- ESTO NO ES UNA MATRIZ: mide. La matriz es 0100_visionados_sellados.sql.
-- Lo que mide, en el orden del informe de la PR:
--   1. lo que cuestan los disparadores en la inserción masiva: los 34.000
--      visionados en UNA sentencia, con los disparadores y sin ellos;
--   2. que la migración entera se puede repetir sobre datos ya cargados
--      (idempotente) y que su comprobación final pasa — y que salta si las
--      columnas vienen mal (se estropean a propósito antes de repetirla);
--   3. marcar y desmarcar UN episodio de una serie de 1.200 (la de One Piece);
--   4. el rollup de 0099 (copiado aquí) contra el de 0100, alternados.
--
--   docker exec -i supabase_db_tvtime psql -U postgres -f - < supabase/sql-checks/0100_banco_visionados_sellados.sql
--
-- ⚠️ Los tiempos de esta pila bailan con lo que haga el Docker de al lado:
-- sirven para comparar en la MISMA vuelta. Y las columnas de los agregados SE
-- LEEN (sum/count): un `count(*) from (…)` deja que el planificador quite los
-- joins y no mide nada — la trampa que documenta 0098.
--
-- tmdb_id 8300xx-8500xx, marcados a propósito.
\set ON_ERROR_STOP on
\timing off
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa', 'medir-0100@example.com')
on conflict (id) do nothing;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa","role":"authenticated"}', true) \g /dev/null

create function pg_temp.rollup_0099(p_kind text default null)
returns table (
  title_id uuid, tmdb_id int, kind text, name text, poster_path text,
  backdrop_path text, first_air_date date, tmdb_status text, genres text[],
  network text, vote_average numeric, favorite boolean, notify boolean,
  stopped boolean, added_at timestamptz, aired_count int, watched_count int,
  last_watched_at timestamptz, last_aired_datetime timestamptz,
  next_air_datetime timestamptz, upcoming_season_number int,
  upcoming_season_air_date date, play_state text, minutes_played int,
  played_at timestamptz, release_precision text, platforms text[],
  beat_seconds jsonb, owned boolean, minutes_source text,
  played_platform text, imdb_rating numeric
)
language sql security invoker stable
as $$
  with mine as (
    select le.* from public.library_entries le
    join public.titles tk on tk.id = le.title_id
    where le.user_id = (select auth.uid()) and le.followed
      and (p_kind is null or tk.kind = p_kind)
  ),
  eps as materialized (
    select e.title_id,
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.season_number > 0 and e.title_id in (select m.title_id from mine m)
    group by e.title_id
  ),
  seen as materialized (
    select e2.title_id, count(*) as watched, max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where wv.user_id = (select auth.uid()) and e2.season_number > 0
      and e2.title_id in (select m.title_id from mine m)
    group by e2.title_id
  )
  select t.id, t.tmdb_id, t.kind, t.name, t.poster_path, t.backdrop_path,
    t.first_air_date, t.status, t.genres, t.network, t.vote_average,
    le.favorite, le.notify, le.stopped, le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int, coalesce(w.watched, 0)::int,
    w.last_watched_at, a.last_aired, a.next_air,
    t.upcoming_season_number, t.upcoming_season_air_date,
    le.play_state, le.minutes_played, le.played_at,
    t.release_precision, t.platforms, t.beat_seconds,
    le.owned, le.minutes_source, le.played_platform, t.imdb_rating
  from mine le
  join public.titles t on t.id = le.title_id
  left join eps a on a.title_id = t.id
  left join seen w on w.title_id = t.id
$$;

-- Una vuelta del rollup, en ms, leyendo las columnas de los agregados.
create function pg_temp.ms(q text) returns numeric language plpgsql as $$
declare l text; r numeric;
begin
  for l in execute 'explain (analyze, timing off, summary on, costs off) ' || q loop
    if l like 'Execution Time:%' then r := substring(l from '([0-9.]+)')::numeric; end if;
  end loop;
  return r;
end $$;

insert into public.titles (tmdb_id, kind, name, first_air_date)
select 830000 + g, 'tv', 'serie ' || g, (now() - interval '3 years')::date from generate_series(1, 410) g;
insert into public.titles (tmdb_id, kind, name, first_air_date)
select 840000 + g, 'movie', 'peli ' || g, (now() - interval '2 years')::date from generate_series(1, 1300) g;
insert into public.titles (tmdb_id, kind, name, first_air_date)
select 850000 + g, 'game', 'juego ' || g, (now() - interval '1 year')::date from generate_series(1, 390) g;

-- 110 episodios por serie = 45.100, y una de 1.200 como la de One Piece.
insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1 + (n / 20), 1 + (n % 20), now() - ((150 - n) || ' days')::interval
from public.titles t, generate_series(0, 109) n
where t.kind = 'tv' and t.tmdb_id between 830002 and 830410;
insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1 + (n / 100), 1 + (n % 100), now() - ((1300 - n) || ' days')::interval
from public.titles t, generate_series(0, 1199) n where t.tmdb_id = 830001;

insert into public.library_entries (user_id, title_id, followed)
select 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa', t.id, true
from public.titles t where t.tmdb_id >= 830000 and t.tmdb_id < 860000;

analyze public.titles; analyze public.episodes; analyze public.library_entries;

-- ── 1. Los 34.000 visionados en UNA sentencia, sin y con disparadores ──────
create temp table vis as
select e.id as episode_id, now() - interval '100 days' + (row_number() over () || ' seconds')::interval as watched_at
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id between 830001 and 830410 and e.air_datetime <= now()
limit 34000;

\echo '--- 1. 34.000 visionados en una sentencia: SIN los disparadores de 0100'
alter table public.watch_events disable trigger watch_counts_insert;
\timing on
insert into public.watch_events (user_id, episode_id, watched_at)
select 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa', episode_id, watched_at from vis;
\timing off
delete from public.watch_events where user_id = 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa';
alter table public.watch_events enable trigger watch_counts_insert;
\echo '--- 1. y CON ellos'
\timing on
insert into public.watch_events (user_id, episode_id, watched_at)
select 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa', episode_id, watched_at from vis;
\timing off
analyze public.watch_events;

select count(*) as visionados, (select sum(watched_count) from public.library_entries
  where user_id = 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa') as suma_de_la_columna
from public.watch_events where user_id = 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa';

-- ── 2. La migración, otra vez, sobre estos datos ──────────────────────────
-- Solo si se pega detrás el fichero de la migración (psql por la entrada
-- estándar no puede hacer `\ir`, el contenedor no tiene el repo):
--
--   cat supabase/sql-checks/0100_banco_visionados_sellados.sql \
--     | sed '/^-- @migracion@$/r supabase/migrations/0100_los_visionados_se_leen.sql' \
--     | docker exec -i supabase_db_tvtime psql -U postgres -f -
--
-- Se estropean las columnas de 50 filas (como postgres, que el guardián deja
-- pasar) y se repite la migración entera: el backfill tiene que arreglarlas y
-- la comprobación final pasar. Sin la migración pegada —la vuelta de
-- correr.sh— el marcador es un comentario y la cuenta de abajo sale 50: es lo
-- esperado, y de paso enseña que la cuenta mira.
update public.library_entries set watched_count = watched_count + 7, last_watched_at = null
where title_id in (select id from public.titles where tmdb_id between 830001 and 830050);
\echo '--- 2. la migración repetida sobre 2.100 filas con 50 estropeadas'
\timing on
-- @migracion@
\timing off
select count(*) as filas_que_no_cuadran
from public.library_entries x
left join (
  select w.user_id, e.title_id, count(*)::int as n, max(w.watched_at) as last
  from public.watch_events w join public.episodes e on e.id = w.episode_id
  where e.season_number > 0 group by 1, 2
) s on s.user_id = x.user_id and s.title_id = x.title_id
where x.user_id = 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa'
  and (x.watched_count, x.last_watched_at) is distinct from (coalesce(s.n, 0), s.last);

-- ── 3. Marcar y desmarcar UN episodio de la serie de 1.200 ────────────────
\echo '--- 3. marcar un episodio (insert: suma) y desmarcar el más reciente (delete: recalcula 1.200)'
\timing on
insert into public.watch_events (user_id, episode_id, watched_at)
select 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa', e.id, now()
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id = 830001 and e.season_number = 12 and e.episode_number = 100;
delete from public.watch_events w using public.episodes e, public.titles t
where w.episode_id = e.id and e.title_id = t.id and t.tmdb_id = 830001
  and e.season_number = 12 and e.episode_number = 100
  and w.user_id = 'aaaaaaaa-0100-0100-0100-aaaaaaaaaaaa';
\timing off

-- ── 4. El rollup: 0099 contra 0100, alternados, siete vueltas ─────────────
\echo '--- 4. rollup, ms por llamada (mediana de 7, alternando 0099 y 0100)'
create temp table t_ms (medio text, def text, ms numeric);
do $$
declare k text; i int; q text :=
  'select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)'
  ' + count(r.last_aired_datetime) + count(r.next_air_datetime) from %s(%L) r';
begin
  foreach k in array array['null', 'tv', 'movie', 'game'] loop
    for i in 1..7 loop
      insert into t_ms values (k, '0099', pg_temp.ms(format(q, 'pg_temp.rollup_0099', nullif(k, 'null'))));
      insert into t_ms values (k, '0100', pg_temp.ms(format(q, 'public.rpc_library_rollup', nullif(k, 'null'))));
    end loop;
  end loop;
end $$;
select medio as p_kind,
  percentile_cont(0.5) within group (order by ms) filter (where def = '0099') as ms_0099,
  percentile_cont(0.5) within group (order by ms) filter (where def = '0100') as ms_0100
from t_ms group by medio order by 1;

\echo '--- 4. y el plan del de 0100 sobre la biblioteca entera'
explain (analyze, timing off, summary on, costs off)
select sum(r.aired_count) + sum(r.watched_count) + count(r.last_watched_at)
     + count(r.last_aired_datetime) + count(r.next_air_datetime)
from public.rpc_library_rollup(null) r;

rollback;
