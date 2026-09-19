-- Matriz de 0100: `library_entries.watched_count` y `last_watched_at`, que desde
-- esa migración mantienen unos disparadores y que el rollup LEE en vez de
-- contar. Lo que se comprueba es lo que no se ve leyendo los disparadores:
-- cada forma de escribir visionados o episodios deja las dos columnas iguales
-- al agregado que calculaba el CTE `seen` de 0099.
--
--   supabase/sql-checks/correr.sh         # todas
--   docker exec -i supabase_db_tvtime psql -U postgres -f - < supabase/sql-checks/0100_visionados_sellados.sql
--
-- Dos redes, y hacen falta las dos:
--   · `pg_temp.cuadra()` compara TODAS las filas de library_entries contra el
--     agregado calculado de cero después de cada paso. Es la que ve un
--     disparador que se olvida de un caso.
--   · el §10 compara el rollup NUEVO contra la definición de 0099 copiada aquí
--     bajo otro nombre (`rollup_0099`), con EXCEPT ALL en los dos sentidos y
--     para cada medio. Es la que ve que el rollup lee otra cosa que la que
--     contaba antes. Mientras 0099 sea la anterior tiene sentido; cuando el
--     rollup vuelva a cambiar, la copia de aquí será historia y el §10 se
--     puede quitar —el §0 de 0098_rollup_sin_laterales.sql sigue vigilando las
--     columnas—.
--
-- Todo dentro de una transacción que acaba en `rollback`. Los tmdb_id son
-- 7100xx, marcados a propósito: un número alto NO es un rango seguro.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 'visionados-0100@example.com'),
  ('ffffffff-0100-0100-0100-ffffffffffff', 'visionados-0100-otro@example.com')
on conflict (id) do nothing;
-- Invitado, porque el §8 escribe como `authenticated` y la policy de escritura
-- de library_entries exige is_invited (0027).
update public.profiles set invited_at = now()
where id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee';

-- ── La definición de 0099, copiada tal cual bajo otro nombre ──────────────
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
    select le.*
    from public.library_entries le
    join public.titles tk on tk.id = le.title_id
    where le.user_id = (select auth.uid()) and le.followed
      and (p_kind is null or tk.kind = p_kind)
  ),
  eps as materialized (
    select
      e.title_id,
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.season_number > 0
      and e.title_id in (select m.title_id from mine m)
    group by e.title_id
  ),
  seen as materialized (
    select
      e2.title_id,
      count(*) as watched,
      max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where wv.user_id = (select auth.uid())
      and e2.season_number > 0
      and e2.title_id in (select m.title_id from mine m)
    group by e2.title_id
  )
  select
    t.id, t.tmdb_id, t.kind, t.name, t.poster_path, t.backdrop_path,
    t.first_air_date, t.status, t.genres, t.network, t.vote_average,
    le.favorite, le.notify, le.stopped, le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.last_aired, a.next_air,
    t.upcoming_season_number, t.upcoming_season_air_date,
    le.play_state, le.minutes_played, le.played_at,
    t.release_precision, t.platforms, t.beat_seconds,
    le.owned, le.minutes_source, le.played_platform, t.imdb_rating
  from mine le
  join public.titles t on t.id = le.title_id
  left join eps a on a.title_id = t.id
  left join seen w on w.title_id = t.id
$$;

-- ── Las dos ayudas ────────────────────────────────────────────────────────
-- Guardado contra calculado, en TODA la tabla. Con `paso` para que el fallo
-- diga dónde.
create function pg_temp.cuadra(paso text) returns void language plpgsql as $$
declare mal bigint; ejemplo text;
begin
  select count(*), min(format('%s/%s guardado=(%s,%s) calculado=(%s,%s)',
           x.user_id, x.title_id, x.watched_count, x.last_watched_at,
           coalesce(s.n, 0), s.last))
    into mal, ejemplo
  from public.library_entries x
  left join (
    select w.user_id, e.title_id, count(*)::int as n, max(w.watched_at) as last
    from public.watch_events w
    join public.episodes e on e.id = w.episode_id
    where e.season_number > 0
    group by w.user_id, e.title_id
  ) s on s.user_id = x.user_id and s.title_id = x.title_id
  where (x.watched_count, x.last_watched_at) is distinct from (coalesce(s.n, 0), s.last);
  assert mal = 0, format('%s: %s filas no cuadran, p. ej. %s', paso, mal, ejemplo);
end $$;

-- Lo guardado de un (usuario, tmdb_id), para las afirmaciones de valor.
create function pg_temp.guardado(u uuid, tmdb int, out n int, out ultimo timestamptz)
language sql as $$
  select le.watched_count, le.last_watched_at
  from public.library_entries le join public.titles t on t.id = le.title_id
  where le.user_id = u and t.tmdb_id = tmdb
$$;

-- Un episodio por (tmdb_id, temporada, número).
create function pg_temp.ep(tmdb int, sn int, en int) returns uuid language sql as $$
  select e.id from public.episodes e join public.titles t on t.id = e.title_id
  where t.tmdb_id = tmdb and e.season_number = sn and e.episode_number = en
$$;

-- ── El escenario ──────────────────────────────────────────────────────────
--   710001 — la serie de casi todo: temporada 1 de 6 episodios y un especial.
--   710002 — la que se ve ANTES de seguirla.
--   710003 — la que se reconstruye.
--   710004 — la de la inserción masiva: 10 temporadas de 60.
--   710005 — una peli, con su episodio sintético (así se marca una peli).
insert into public.titles (tmdb_id, kind, name) values
  (710001, 'tv', 'casi todo'), (710002, 'tv', 'vista antes de seguirla'),
  (710003, 'tv', 'reconstruida'), (710004, 'tv', 'masiva'),
  (710005, 'movie', 'peli');

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, s.sn, s.en, now() - interval '60 days' + (s.en || ' days')::interval
from public.titles t,
  (values (1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(0,1)) as s(sn, en)
where t.tmdb_id in (710001, 710002, 710003);

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, sn, en, now() - interval '400 days'
from public.titles t, generate_series(1, 10) sn, generate_series(1, 60) en
where t.tmdb_id = 710004;

-- La peli no lleva insert: su S1E1 sintético lo crea el disparador de 0067.

insert into public.library_entries (user_id, title_id, followed)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', t.id, true
from public.titles t where t.tmdb_id in (710001, 710003, 710004, 710005);
insert into public.library_entries (user_id, title_id, followed)
select 'ffffffff-0100-0100-0100-ffffffffffff', t.id, true
from public.titles t where t.tmdb_id in (710001, 710003);

select pg_temp.cuadra('alta sin visionados');

-- ── 1. Insertar ───────────────────────────────────────────────────────────
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710001,1,1), '2026-01-10'),
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710001,1,2), '2026-01-20');
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710001,1,3), '2026-01-30');
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 3, format('tres visionados y cuenta %s', g.n);
  assert g.ultimo = '2026-01-30', format('el ultimo es el 30 y dice %s', g.ultimo);
end $$;
select pg_temp.cuadra('insertar');

-- ── 2. Los especiales no cuentan ──────────────────────────────────────────
-- Y más reciente que todos: si contara, movería también la fecha.
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710001,0,1), '2026-03-01');
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 3, format('el especial ha sumado: %s', g.n);
  assert g.ultimo = '2026-01-30', format('el especial ha movido la fecha: %s', g.ultimo);
end $$;
select pg_temp.cuadra('especial');

-- ── 3. Otro usuario no contamina ──────────────────────────────────────────
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('ffffffff-0100-0100-0100-ffffffffffff', pg_temp.ep(710001,1,1), '2026-02-15'),
  ('ffffffff-0100-0100-0100-ffffffffffff', pg_temp.ep(710001,1,4), '2026-02-16');
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 3 and g.ultimo = '2026-01-30',
    format('los visionados del otro han entrado en los tuyos: (%s, %s)', g.n, g.ultimo);
  g := pg_temp.guardado('ffffffff-0100-0100-0100-ffffffffffff', 710001);
  assert g.n = 2 and g.ultimo = '2026-02-16', format('el otro: (%s, %s)', g.n, g.ultimo);
end $$;
select pg_temp.cuadra('otro usuario');

-- ── 4. Borrar uno que no es el último, y luego el último ──────────────────
delete from public.watch_events
where user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee' and episode_id = pg_temp.ep(710001,1,1);
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 2 and g.ultimo = '2026-01-30', format('tras borrar el primero: (%s, %s)', g.n, g.ultimo);
end $$;
delete from public.watch_events
where user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee' and episode_id = pg_temp.ep(710001,1,3);
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  -- La trampa de restar: la cuenta bajaría bien y la fecha se quedaría en el 30.
  assert g.n = 1, format('tras borrar el ultimo cuenta %s', g.n);
  assert g.ultimo = '2026-01-20', format('borrado el mas reciente, la fecha tiene que volver al 20 y dice %s', g.ultimo);
end $$;
-- Y el borrado del especial no toca nada.
delete from public.watch_events
where user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee' and episode_id = pg_temp.ep(710001,0,1);
-- Y borrarlo todo deja 0 y null, no el último valor.
delete from public.watch_events
where user_id = 'ffffffff-0100-0100-0100-ffffffffffff';
do $$ declare g record; begin
  g := pg_temp.guardado('ffffffff-0100-0100-0100-ffffffffffff', 710001);
  assert g.n = 0 and g.ultimo is null, format('sin visionados deberia ser (0, null): (%s, %s)', g.n, g.ultimo);
end $$;
select pg_temp.cuadra('borrar');

-- ── 5. Actualizar: la fecha, y el episodio a otro título ──────────────────
update public.watch_events set watched_at = '2026-04-01'
where user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee' and episode_id = pg_temp.ep(710001,1,2);
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.ultimo = '2026-04-01', format('la fecha actualizada no llega: %s', g.ultimo);
end $$;
update public.watch_events set episode_id = pg_temp.ep(710003,1,1)
where user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee' and episode_id = pg_temp.ep(710001,1,2);
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 0 and g.ultimo is null, format('el titulo de origen no ha restado: (%s, %s)', g.n, g.ultimo);
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710003);
  assert g.n = 1 and g.ultimo = '2026-04-01', format('el de destino no ha sumado: (%s, %s)', g.n, g.ultimo);
end $$;
select pg_temp.cuadra('actualizar');

-- ── 6. Seguir DESPUÉS de ver ──────────────────────────────────────────────
-- Lo que hace useMarkWatched: primero el visionado, luego el seguimiento.
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710002,1,1), '2026-05-01'),
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710002,1,2), '2026-05-02'),
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710002,0,1), '2026-05-03');
-- Y con un valor inventado en la fila, que el alta tiene que pisar.
insert into public.library_entries (user_id, title_id, followed, watched_count, last_watched_at)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', t.id, true, 999, '2030-01-01'
from public.titles t where t.tmdb_id = 710002;
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710002);
  assert g.n = 2 and g.ultimo = '2026-05-02', format('seguir despues de ver: (%s, %s)', g.n, g.ultimo);
end $$;
-- Dejar de seguir y volver: `followed` es una columna, la fila no se va.
update public.library_entries le set followed = false
from public.titles t where t.id = le.title_id and t.tmdb_id = 710002;
delete from public.library_entries le using public.titles t
where t.id = le.title_id and t.tmdb_id = 710002;
insert into public.library_entries (user_id, title_id, followed)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', t.id, true
from public.titles t where t.tmdb_id = 710002;
select pg_temp.cuadra('seguir despues de ver');

-- ── 7. Reconstrucción de la serie ─────────────────────────────────────────
-- Los dos usuarios han visto 710003. Se borran sus episodios —la cascada se
-- lleva los visionados— y se vuelven a crear, como haría un refresco que
-- rehiciera la serie desde TMDB. Los visionados no vuelven: el contador tiene
-- que bajar a cero, no quedarse con lo de antes.
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710003,1,2), '2026-06-01'),
  ('ffffffff-0100-0100-0100-ffffffffffff', pg_temp.ep(710003,1,2), '2026-06-02'),
  ('ffffffff-0100-0100-0100-ffffffffffff', pg_temp.ep(710003,1,3), '2026-06-03');
-- Primero un episodio suelto: baja uno.
delete from public.episodes where id = pg_temp.ep(710003,1,3);
do $$ declare g record; begin
  g := pg_temp.guardado('ffffffff-0100-0100-0100-ffffffffffff', 710003);
  assert g.n = 1 and g.ultimo = '2026-06-02',
    format('borrado el episodio, su visionado sigue contando: (%s, %s)', g.n, g.ultimo);
end $$;
select pg_temp.cuadra('episodio borrado');
-- Luego la temporada entera, y vuelve a nacer.
delete from public.episodes e using public.titles t
where t.id = e.title_id and t.tmdb_id = 710003;
insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1, en, now() - interval '10 days' from public.titles t, generate_series(1, 6) en
where t.tmdb_id = 710003;
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710003);
  assert g.n = 0 and g.ultimo is null, format('reconstruida, tuyo: (%s, %s)', g.n, g.ultimo);
  g := pg_temp.guardado('ffffffff-0100-0100-0100-ffffffffffff', 710003);
  assert g.n = 0 and g.ultimo is null, format('reconstruida, del otro: (%s, %s)', g.n, g.ultimo);
end $$;
select pg_temp.cuadra('serie reconstruida');

-- Un episodio que pasa a especial deja de contar (y al revés).
insert into public.watch_events (user_id, episode_id, watched_at) values
  ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710003,1,5), '2026-06-10');
update public.episodes set season_number = 0 where id = pg_temp.ep(710003,1,5);
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710003);
  assert g.n = 0, format('el episodio pasado a especial sigue contando: %s', g.n);
end $$;
update public.episodes set season_number = 1 where id = pg_temp.ep(710003,0,5);
select pg_temp.cuadra('episodio que cambia de temporada');

-- ── 8. El cliente no puede falsear su recuento ────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0100-0100-0100-eeeeeeeeeeee","role":"authenticated"}', true);
set local role authenticated;
update public.library_entries le set watched_count = 999, last_watched_at = '2030-01-01', favorite = true
from public.titles t where t.id = le.title_id and t.tmdb_id = 710001;
-- Y el upsert de PostgREST, que es un insert con ON CONFLICT DO UPDATE.
insert into public.library_entries (user_id, title_id, followed, watched_count)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', t.id, true, 777
from public.titles t where t.tmdb_id = 710005
on conflict (user_id, title_id) do update set watched_count = excluded.watched_count;
-- Tampoco puede llamar al recálculo (que tocaría pares ajenos).
do $$ begin
  begin
    perform public.library_watch_counts_refresh(array[]::uuid[], array[]::uuid[]);
    assert false, 'authenticated puede llamar a library_watch_counts_refresh';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ declare g record; fav boolean; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710001);
  assert g.n = 0 and g.ultimo is null, format('el cliente ha escrito su recuento: (%s, %s)', g.n, g.ultimo);
  select le.favorite into fav from public.library_entries le join public.titles t on t.id = le.title_id
  where t.tmdb_id = 710001 and le.user_id = 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee';
  assert fav, 'el guardian se ha comido tambien el resto de la actualizacion';
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710005);
  assert g.n = 0, format('el upsert del cliente ha escrito su recuento: %s', g.n);
end $$;
select pg_temp.cuadra('cliente');

-- ── 9. Inserción masiva, y la reimportación ───────────────────────────────
-- 600 visionados en UNA sentencia (lo que hace la importación por serie o
-- rpc_mark_series), mezclados con uno que ya existía y que ON CONFLICT DO
-- NOTHING se salta: no puede contar dos veces.
insert into public.watch_events (user_id, episode_id, watched_at)
values ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710004,1,1), '2025-01-01');
insert into public.watch_events (user_id, episode_id, watched_at)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', e.id,
       '2025-01-01'::timestamptz + (e.season_number * 100 + e.episode_number || ' minutes')::interval
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id = 710004
on conflict (user_id, episode_id) do nothing;
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710004);
  assert g.n = 600, format('masiva: 600 episodios y cuenta %s', g.n);
  assert g.ultimo = '2025-01-01'::timestamptz + interval '1060 minutes', format('masiva, fecha: %s', g.ultimo);
end $$;
-- La reimportación de TV Time: upsert SIN ignoreDuplicates, o sea DO UPDATE,
-- que reescribe watched_at. Tiene que recalcular, no sumar otra vez.
insert into public.watch_events (user_id, episode_id, watched_at, source)
select 'eeeeeeee-0100-0100-0100-eeeeeeeeeeee', e.id, '2025-06-01', 'tvtime_import'
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id = 710004 and e.season_number = 1
on conflict (user_id, episode_id) do update set watched_at = excluded.watched_at;
do $$ declare g record; begin
  g := pg_temp.guardado('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', 710004);
  assert g.n = 600, format('la reimportacion ha contado dos veces: %s', g.n);
  assert g.ultimo = '2025-06-01', format('la reimportacion no ha movido la fecha: %s', g.ultimo);
end $$;
-- Y la peli, con su episodio sintético.
insert into public.watch_events (user_id, episode_id, watched_at)
values ('eeeeeeee-0100-0100-0100-eeeeeeeeeeee', pg_temp.ep(710005,1,1), '2026-07-07');
select pg_temp.cuadra('masiva');

-- ── 10. El rollup nuevo contra el de 0099, EXCEPT ALL en los dos sentidos ──
-- Para los dos usuarios y los cuatro valores de p_kind. Cero filas de más en
-- cualquiera de los dos lados.
update public.library_entries set followed = true;
do $$
declare u uuid; k text; nuevo_sobra bigint; viejo_sobra bigint; filas bigint;
begin
  foreach u in array array['eeeeeeee-0100-0100-0100-eeeeeeeeeeee',
                           'ffffffff-0100-0100-0100-ffffffffffff']::uuid[] loop
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', u), true);
    foreach k in array array[null, 'tv', 'movie', 'game'] loop
      select count(*) into nuevo_sobra from (
        select * from public.rpc_library_rollup(k)
        except all select * from pg_temp.rollup_0099(k)) x;
      select count(*) into viejo_sobra from (
        select * from pg_temp.rollup_0099(k)
        except all select * from public.rpc_library_rollup(k)) x;
      select count(*) into filas from public.rpc_library_rollup(k);
      raise notice 'EXCEPT ALL % p_kind=%: filas=%, nuevo-viejo=%, viejo-nuevo=%',
        u, coalesce(k, 'null'), filas, nuevo_sobra, viejo_sobra;
      assert nuevo_sobra = 0 and viejo_sobra = 0,
        format('el rollup de 0100 no es el de 0099 para %s, p_kind %s: %s / %s',
               u, k, nuevo_sobra, viejo_sobra);
    end loop;
  end loop;
end $$;

-- Y que la comparación mira de verdad: con los visionados en cuenta, que el
-- EXCEPT tenga algo que comparar. Si el escenario acabara con todo a cero, un
-- rollup que devolviera 0 siempre pasaría el §10.
do $$ declare n bigint; begin
  perform set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-0100-0100-0100-eeeeeeeeeeee","role":"authenticated"}', true);
  select count(*) into n from public.rpc_library_rollup() where watched_count > 0 and last_watched_at is not null;
  assert n >= 3, format('el escenario deberia acabar con 3 titulos vistos y hay %s', n);
end $$;

rollback;
