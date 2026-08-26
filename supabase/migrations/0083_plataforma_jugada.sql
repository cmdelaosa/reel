-- 0083_plataforma_jugada.sql
-- En qué plataforma juegas cada juego. Una columna, y el rollup que la lleva
-- hasta la biblioteca.
--
-- ── Qué falta hoy ─────────────────────────────────────────────────────────
-- La ficha de un juego enseña SUS plataformas —las que IGDB dice que existen,
-- con su fecha— y ni una palabra sobre la tuya. Y esa es justo la que hace
-- falta para volver a ponerte: un juego que tienes en Switch y en PS5 no se
-- retoma igual, y el que compraste en GOG hace tres años no está donde tú
-- crees. Es el mismo hueco que 0076 tapó con `owned` ("es mío") un escalón más
-- abajo: esto responde DÓNDE.
--
-- ── Por qué una y no varias ───────────────────────────────────────────────
-- `text` y no `text[]`. La pregunta que se contesta es "¿dónde lo juego?", y
-- esa tiene una respuesta: si lo rejugaste en la consola nueva, la respuesta
-- CAMBIA, no se acumula. Una lista obligaría a cada sitio que la pinte a
-- decidir qué enseña cuando son tres —y a inventar un orden— para un caso que
-- casi no ocurre. Null es "no lo he dicho", que es el estado de todo lo que ya
-- hay en la base y de todo lo que entre por la importación de Steam.
--
-- Se guarda el NOMBRE de la plataforma, no un id: es la misma llave con la que
-- `titles.platforms` (text[]) y `titles.platform_releases` (jsonb) hablan de
-- ellas desde 0071, y la ficha ofrece a elegir exactamente esa lista. Guardar
-- el id de IGDB obligaría a traducirlo en cada pantalla con una tabla que no
-- tenemos.
--
-- No hay `check`: la lista de plataformas de un juego la manda IGDB y crece
-- sola. Una restricción aquí sería una migración cada vez que salga una
-- consola, y lo peor que puede pasar es que quede escrito el nombre de una
-- plataforma que IGDB renombró — se ve, y se vuelve a pulsar.
--
-- ── El rollup ─────────────────────────────────────────────────────────────
-- La biblioteca es UNA consulta y la columna viaja con ella, como `play_state`,
-- `minutes_played` y `owned` (0073, 0076): pedirla aparte sería un viaje más
-- para una columna de la fila que ya se está leyendo.
--
-- El cuerpo de abajo es el de 0081 —el ÚLTIMO que recrea esta función— más
-- `le.played_platform`. Ni una línea más. Quien la toque después que haga lo
-- que 0081 aprendió a la mala:
--
--   **grep -n "create function public.rpc_library_rollup" supabase/migrations/*.sql**
--   **y COPIA EL ÚLTIMO, no el que tenías abierto.**
--
-- `drop` y `create` y no `create or replace`: cambia el RETURNS TABLE, y
-- Postgres no deja reemplazar una función cuyo tipo de retorno cambia.

-- ============================================================
-- 1. La columna
-- ============================================================
alter table public.library_entries
  add column if not exists played_platform text;

comment on column public.library_entries.played_platform is
  'En qué plataforma juegas TÚ este juego, por su nombre de IGDB tal y como '
  'aparece en titles.platforms (0071). Una sola: la pregunta es "¿dónde lo '
  'juego?" y esa respuesta cambia, no se acumula. Null = no lo has dicho. '
  'Solo tiene sentido en kind=''game''; en series y cine se queda null.';

-- ============================================================
-- 2. El rollup, con la columna dentro
-- ============================================================
drop function if exists public.rpc_library_rollup();
create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  kind text,
  name text,
  poster_path text,
  -- Justo detrás del póster porque son la misma cosa contada dos veces: el
  -- retrato y el apaisado. Quien lea esta lista buscando "¿qué imagen tengo?"
  -- las encuentra juntas.
  backdrop_path text,
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
  -- Justo detrás de las otras tres columnas de la fila de biblioteca de un
  -- juego (estado, horas, «lo tengo»): es una más de las que dice la persona,
  -- y no un dato del título.
  played_platform text,
  imdb_rating numeric
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
    t.backdrop_path,
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
    le.played_platform,
    t.imdb_rating
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
