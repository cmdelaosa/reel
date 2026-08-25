-- 0073_game_progress.sql
-- Las horas jugadas y en qué punto está cada juego. La mitad de datos del modo
-- Videojuegos; la otra mitad —el catálogo— la puso 0071.
--
-- ── Por qué esto no es aritmética, como en los otros dos medios ───────────
-- El estado de una serie sale de contar (emitidos contra vistos) y el de una
-- película también. El de un juego no se puede contar: "lo estoy jugando" y "lo
-- dejé" describen algo que no está en ninguna tabla, sino en tu cabeza o en una
-- partida guardada que Reel no ve. Así que hay dos fuentes:
--
--   * `watch_events` sobre el episodio sintético — TERMINADO, exactamente el
--     mismo mecanismo que "visto" en cine. Por eso un juego terminado entra en
--     el historial, en el muro y en las notas sin que ninguno sepa que existen
--     los videojuegos.
--   * `library_entries.play_state` — lo que la persona dice a mano.
--
-- TERMINADO no está en play_state a propósito. Si lo estuviera habría dos
-- formas de decir lo mismo y algún día dirían cosas distintas: un juego con
-- play_state='finished' y sin watch_event saldría terminado en la biblioteca y
-- no en el historial. La derivación completa, con sus tests, está en
-- app/src/domain/gameStatus.ts.
--
-- ── El quinto estado ──────────────────────────────────────────────────────
-- 'ongoing' es para Counter-Strike, el LoL o un PUBG: juegos que no se acaban.
-- No es que no los hayas acabado — es que no tienen créditos, y ofrecer
-- "Terminado" en su ficha sería ofrecer algo imposible. Se modela como estado y
-- no como propiedad del título porque IGDB no marca en ningún sitio "esto no
-- acaba" (lo más cerca es que le falten los tiempos de game_time_to_beats, y
-- deducirlo de un dato ausente es frágil), así que de un modo u otro se marca a
-- mano. Y deja libre 'dropped' para el día que dejes el CS: dejarlo es una cosa
-- y que sea infinito es otra.
--
-- ── Los minutos ───────────────────────────────────────────────────────────
-- En minutos y no en horas porque una tarde suelta con un juego pequeño son 40
-- minutos, y guardar horas obligaría a decimales para no mentir. El
-- denominador —cuánto se tarda en terminarlo— vive en titles.beat_seconds
-- (0071) y es del catálogo, no de la persona.
--
-- `minutes_source` existe para la sincronización con Steam, que va en su propia
-- rama: cuando llegue, tiene que poder distinguir lo que escribió ella de lo
-- que escribiste tú, para no pisarte una cifra que corregiste a mano. Hoy solo
-- vale 'manual', y esa es toda la deuda que deja preparada.

-- ============================================================
-- 1. Las tres columnas
-- ============================================================
-- Van en library_entries y no en una tabla nueva porque library_entries YA es
-- la fila por (usuario, título): una tabla aparte sería la misma clave, la
-- misma RLS y un join en cada lectura de la biblioteca para no ahorrar nada.
alter table public.library_entries add column if not exists play_state text;
alter table public.library_entries drop constraint if exists library_entries_play_state_check;
alter table public.library_entries add constraint library_entries_play_state_check
  check (play_state is null or play_state in ('playing', 'ongoing', 'dropped'));

-- not null con default 0: "no he jugado nada" y "no lo sé" son lo mismo aquí, y
-- un nullable obligaría a un coalesce en cada suma.
alter table public.library_entries add column if not exists minutes_played int not null default 0;
alter table public.library_entries drop constraint if exists library_entries_minutes_played_check;
alter table public.library_entries add constraint library_entries_minutes_played_check
  check (minutes_played >= 0);

alter table public.library_entries add column if not exists minutes_source text;
alter table public.library_entries drop constraint if exists library_entries_minutes_source_check;
alter table public.library_entries add constraint library_entries_minutes_source_check
  check (minutes_source is null or minutes_source in ('manual', 'steam'));

comment on column public.library_entries.play_state is
  'Solo juegos: playing | ongoing | dropped. TERMINADO no esta aqui, es el watch_event del episodio sintetico. Null en tv y movie.';
comment on column public.library_entries.minutes_played is
  'Solo juegos: minutos jugados. El denominador esta en titles.beat_seconds (0071).';

-- ============================================================
-- 2. La biblioteca sirve lo que el modo necesita
-- ============================================================
-- Cuerpo idéntico al de 0067 salvo las columnas nuevas. Se añaden a la MISMA
-- función y no a una de juegos, por lo mismo que 0067 le añadió `kind` en vez
-- de partirla: la biblioteca es una sola tabla y quien la lee decide qué mitad
-- enseña. Partirla habría duplicado el lateral de los conteos, que es lo caro.
--
-- `beat_seconds` y `platforms` viajan aunque solo los use un medio: la lista de
-- juegos pinta la barra de progreso y las plataformas en la propia tarjeta, y
-- pedirlos aparte sería una segunda consulta por cada pantalla de biblioteca.
-- En series y películas llegan nulos y vacíos, que es lo que son.
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
  release_precision text,
  platforms text[],
  beat_seconds jsonb
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
    t.release_precision,
    t.platforms,
    t.beat_seconds
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
