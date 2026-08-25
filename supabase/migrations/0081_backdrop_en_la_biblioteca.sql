-- 0081_backdrop_en_la_biblioteca.sql
-- El fondo panorámico del título viaja en el rollup de la biblioteca.
--
-- POR QUÉ. El hero de Esta noche es un banner de 21:9. El de series pinta ahí
-- `titles.backdrop_path` —el fotograma apaisado de TMDB— y cae al póster solo en
-- el ~3% de títulos que no tienen uno (0049 añadió la columna a rpc_up_next
-- justo para eso). El de cine no podía: su fila sale de rpc_library_rollup, que
-- no devuelve backdrop_path, así que pintaba SIEMPRE el póster.
--
-- Y un póster es 2:3. Metido en un hueco de 21:9 con object-fit: cover, lo que
-- se ve no es la carátula sino una franja central ampliada de ella: cara cortada
-- por arriba y por abajo, título de la peli fuera del encuadre, y el aspecto de
-- un zoom mal hecho. No era un fallo de CSS — el banner hace lo que le mandan—,
-- era que a esa pantalla nunca le llegó la única imagen con la forma correcta.
--
-- Los juegos no entran aquí: IGDB no da apaisada (igdb-proxy no escribe
-- backdrop_path), así que su hero seguirá con la portada a propósito, y con la
-- misma reserva que usan las pelis sin fondo.
--
-- Como en 0080, la columna nueva va AL FINAL de la lista de retorno; el cliente
-- valida por nombre (libraryRowSchema), pero el orden se respeta por si alguien
-- lee posicionalmente.

-- La definición completa, copiada de 0080 con una línea más en cada sitio. Quien
-- la toque después: `grep -n "create function public.rpc_library_rollup"
-- supabase/migrations/*.sql` y parte del número más alto, que es este.
drop function if exists public.rpc_library_rollup();
create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  kind text,
  name text,
  poster_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  stopped boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  last_aired_datetime timestamptz,
  next_air_datetime timestamptz,
  upcoming_season_number int,
  upcoming_season_air_date date,
  play_state text,
  minutes_played int,
  played_at timestamptz,
  release_precision text,
  platforms text[],
  beat_seconds jsonb,
  owned boolean,
  minutes_source text,
  imdb_rating numeric,
  backdrop_path text
)
language sql
security invoker
stable
as $$
  select
    t.id,
    t.tmdb_id,
    t.kind,
    t.name,
    t.poster_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.stopped,
    le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.last_aired,
    a.next_air,
    t.upcoming_season_number,
    t.upcoming_season_air_date,
    le.play_state,
    le.minutes_played,
    le.played_at,
    t.release_precision,
    t.platforms,
    t.beat_seconds,
    le.owned,
    le.minutes_source,
    t.imdb_rating,
    t.backdrop_path
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  left join lateral (
    select count(*) as watched, max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where e2.title_id = t.id and e2.season_number > 0 and wv.user_id = le.user_id
  ) w on true
  where le.user_id = (select auth.uid()) and le.followed
$$;
grant execute on function public.rpc_library_rollup() to authenticated;
