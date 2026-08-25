-- 0080_rollup_backdrop.sql
-- `backdrop_path` viaja en la biblioteca. Una columna, y todo lo demás es
-- explicar por qué faltaba.
--
-- ── El síntoma ────────────────────────────────────────────────────────────
-- El banner de "Esta noche" en Videojuegos enseñaba un trozo de la CARÁTULA
-- ampliado: una imagen de 264×374 estirada a un hueco de ~1200 de ancho y
-- recortada con `object-fit: cover`, o sea la franja central del dibujo, movida
-- y borrosa. En Cine pasaba lo mismo con el póster. Solo el de Series estaba
-- bien, y por casualidad: su héroe no sale de esta función sino de la consulta
-- de episodios, que sí trae el fotograma.
--
-- El dato existía desde el primer día. `titles.backdrop_path` lo llena
-- igdb-proxy con `artworks[0] ?? screenshots[0]` (normalize.ts) y tmdb-proxy con
-- el suyo; la ficha del juego ya lo pinta. Lo que faltaba era el camino:
-- `rpc_library_rollup` devuelve treinta columnas y esa no estaba, así que quien
-- pintaba el banner no tenía con qué y caía a lo único que tenía a mano.
--
-- Medido en la biblioteca que destapó esto: 384 de 386 juegos tienen artwork.
-- El respaldo a la carátula se queda —para esos dos y para lo que TMDB no
-- fotografía— pero deja de ser el caso normal.
--
-- ── Por qué en el rollup y no en una consulta aparte ──────────────────────
-- Es el mismo argumento que 0073 usó para `beat_seconds` y `platforms`: la
-- biblioteca es UNA consulta y cada pantalla la reusa. Pedir la imagen por
-- separado sería un viaje más en cada carga para traer una columna de la fila
-- que ya está leyendo. Y viaja para los tres medios aunque el banner sea de
-- uno: en series y cine es el mismo campo con el mismo significado.
--
-- ── El precio, dicho ──────────────────────────────────────────────────────
-- Una columna más en la fila que el navegador se descarga entera. Son ~30
-- caracteres por título; en una biblioteca de 400, unos 12 KB. Frente a
-- descargar el banner equivocado y volver a pedir el bueno, no hay discusión.
--
-- `drop` y `create` y no `create or replace`: cambia el RETURNS TABLE, y
-- Postgres no deja reemplazar una función cuyo tipo de retorno cambia. El
-- cuerpo es el de 0076 con `t.backdrop_path` añadido detrás de `t.poster_path`;
-- ni una línea más.

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
  minutes_source text
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
    le.minutes_source
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

comment on column public.titles.backdrop_path is
  'La imagen apaisada. TMDB: ruta relativa (/abc.jpg). IGDB: el image_id del '
  'primer artwork, o del primer screenshot si no hay artworks (normalize.ts). '
  'Es la del banner de Esta noche; la carátula es el respaldo, no al revés.';
