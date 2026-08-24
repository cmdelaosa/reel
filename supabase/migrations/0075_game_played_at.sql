-- 0075_game_played_at.sql
-- Cuándo tocaste un juego por última vez. Es la columna que le faltaba a
-- «vuelve a lo que estabas jugando», que es de lo que va la pantalla de Esta
-- noche en el modo Videojuegos.
--
-- ── Por qué no salía de lo que ya había ───────────────────────────────────
-- En series eso se responde solo: el último episodio marcado tiene fecha, y
-- rpc_library_rollup ya devuelve `last_watched_at`. En juegos no hay nada
-- equivalente. `watch_events` guarda UN evento por juego —el episodio sintético
-- de 0071, que significa "me salieron los créditos"—, así que `last_watched_at`
-- de un juego o es null o es el día que lo terminaste: justo lo contrario de lo
-- que Esta noche quiere enseñar.
--
-- Lo que sí cambia cada vez que juegas es lo que apuntas: las horas y el
-- estado. Pero 0073 las guardó como CONTADOR y como ETIQUETA, sin fecha —
-- `minutes_played` sabe cuánto, no cuándo. Ordenar por `added_at` (lo único con
-- fecha) pone arriba el juego que metiste en Reel hace tres meses y no has
-- vuelto a abrir, por delante del que jugaste anoche.
--
-- ── Por qué un disparador y no el cliente ─────────────────────────────────
-- La tentación es escribir `played_at: now()` desde useSetGameProgress, que es
-- el único sitio que hoy escribe estas columnas. Sería cierto hoy y falso en la
-- rama siguiente: la sincronización con Steam (0073 le dejó `minutes_source`
-- preparado) va a escribir minutos desde una edge function, y ahí nadie se
-- acordaría de esta columna. Un disparador no se puede olvidar, y además hace
-- que la marca signifique exactamente lo que dice — "esta fila cambió" — en vez
-- de "alguien que sabía de esta columna la cambió".
--
-- ── Nullable, y sin relleno ───────────────────────────────────────────────
-- Las filas que ya existen se quedan en null y NO se rellenan con `added_at`.
-- Sería inventar una fecha, que es justo lo que 0074 se negó a hacer para
-- publicar "empezó a jugar" en el muro. Null aquí dice la verdad —"no consta
-- que hayas tocado esto"— y el cliente sabe caer a `added_at` para ordenar, que
-- es una elección de presentación y no un dato guardado.

-- ============================================================
-- 1. La columna
-- ============================================================
alter table public.library_entries add column if not exists played_at timestamptz;

comment on column public.library_entries.played_at is
  'Solo juegos: cuando cambio por ultima vez minutes_played o play_state, puesto por el disparador game_progress_touch (0075). Null = no consta. NO es "cuando lo terminaste": eso es el watch_event del episodio sintetico.';

-- Índice parcial: la única consulta es "mis juegos, por lo último tocado", y un
-- índice completo cargaría también las filas de series y cine, que tienen esta
-- columna siempre a null.
create index if not exists library_entries_played_at_idx
  on public.library_entries (user_id, played_at desc)
  where played_at is not null;

-- ============================================================
-- 2. El disparador
-- ============================================================
-- `is distinct from` y no `<>`: `play_state` es nullable, y con `<>` quitar el
-- estado (playing → null, que es como se vuelve a "Pendiente" desde la ficha)
-- daba NULL en la comparación, o sea ni true ni false, y la marca no se
-- escribía. Quitar un estado también es tocarlo.
--
-- La condición va en el WHEN del disparador y no en el cuerpo: así una
-- actualización que solo cambie `favorite` o `notify` ni siquiera entra en la
-- función.
create or replace function public.game_progress_touch()
returns trigger
language plpgsql
as $$
begin
  new.played_at := now();
  return new;
end;
$$;

drop trigger if exists game_progress_touch on public.library_entries;
create trigger game_progress_touch
  before update on public.library_entries
  for each row
  when (
    old.minutes_played is distinct from new.minutes_played
    or old.play_state is distinct from new.play_state
  )
  execute function public.game_progress_touch();

-- Y en el alta, solo si la fila NACE con progreso — que hoy no pasa (se sigue
-- el juego primero y se apuntan las horas después) pero pasará en cuanto la
-- importación de Steam exista. Un insert normal deja la columna en null, que es
-- lo correcto: seguir un juego no es haberlo jugado.
drop trigger if exists game_progress_touch_insert on public.library_entries;
create trigger game_progress_touch_insert
  before insert on public.library_entries
  for each row
  when (new.minutes_played > 0 or new.play_state is not null)
  execute function public.game_progress_touch();

-- ============================================================
-- 3. La biblioteca sirve la columna nueva
-- ============================================================
-- Cuerpo idéntico al de 0073 salvo `played_at`. Cambia el RETURNS TABLE, así
-- que drop y create; el `create or replace` de 0073 valía porque allí las
-- columnas nuevas se añadían a una función que se estaba recreando entera.
--
-- Viaja para los tres medios aunque solo la use uno, por lo mismo que
-- `beat_seconds` y `platforms` en 0073: la biblioteca es una sola consulta y
-- pedir esto aparte sería un viaje más en cada pantalla que la lee. En series y
-- cine llega null, que es lo que es.
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
    le.played_at,
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
