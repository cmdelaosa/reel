-- 0080_imdb_rating_en_la_biblioteca.sql
-- Dos cosas para que el cine tenga nota de IMDb: la marca de "ya pregunté por
-- este id" que hace sostenible el repaso horario, y la nota en el rollup de la
-- biblioteca.
--
-- ── 1. La nota viaja en el rollup ───────────────────────────────────────────
--
-- POR QUÉ. La carátula de una película enseña ahora la nota de IMDb (y la de
-- TMDB solo de reserva; ver app/src/domain/externalScore.ts). Las rejillas de
-- Explorar ya podían: leen filas de `titles` enteras, donde la columna existe
-- desde 0057. La biblioteca no: lee `rpc_library_rollup`, que devuelve una
-- selección de columnas y nunca incluyó esta — así que Tus pelis y el carril de
-- Esta noche se habrían quedado con la de TMDB mientras Explorar enseñaba la de
-- IMDb, dos números distintos para la misma película a dos pantallas de
-- distancia.
--
-- `imdb_votes` NO viaja. La carátula no lo enseña (no cabe), y la ficha —que sí
-- lo pone en el title del número— no lee el rollup: viene de tmdb-proxy con la
-- fila completa. Una columna por fila y por pantalla no se paga por si acaso.
--
-- La columna va AL FINAL de la lista de retorno, que es lo que hace que esto no
-- rompa nada: el cliente valida por nombre (libraryRowSchema) y el resto de
-- consumidores nombran sus columnas, pero un `select *` posicional sobre una
-- función que devuelve tabla sí notaría un cambio de orden en medio.
--
-- Sirve para los tres medios, no solo para el cine: una serie con nota de IMDb
-- la trae también. Quien la pinta es quien decide, y hoy la carátula de series
-- sigue con la de TMDB a propósito.

-- ============================================================
-- 2. Cuándo se preguntó por última vez por el imdb_id de un título
-- ============================================================
-- El repaso de ids (episode-refresh?backfillImdbIds=1) pasa a correr CADA HORA
-- por cron, y sin esta columna esa frecuencia se convierte en trabajo perpetuo:
-- los títulos que TMDB sencillamente no tiene vinculados a IMDb no se resuelven
-- nunca, se quedan en la cola para siempre, y cada ronda gasta su presupuesto
-- volviendo a preguntar por los mismos. Con la pasada a mano eso era una
-- molestia; con un cron horario son cientos de peticiones a TMDB cada hora, a
-- perpetuidad, para recibir la misma negativa.
--
-- Se sella en CADA respuesta de TMDB —resuelto o "no tengo id"—, pero NO cuando
-- la petición falla: un 429 o un corte de red no son una respuesta, y sellarlos
-- escondería el título durante un mes por un fallo de un segundo.
--
-- El mes de espera antes de repreguntar (RECHECK_DAYS en la función) no es
-- pesimismo: TMDB añade ids con el tiempo, sobre todo en estrenos que aún no
-- están en IMDb cuando los cacheamos. Reintentar es correcto; reintentar cada
-- hora, no.
alter table public.titles add column if not exists imdb_id_checked_at timestamptz;

-- ============================================================
-- 3. El rollup de la biblioteca
-- ============================================================
-- La definición completa, copiada de 0076 y con una sola línea más en cada
-- sitio. Quien la toque después: `grep -n "create function public.rpc_library_rollup"
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
