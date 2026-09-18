-- 0098_el_rollup_sin_dos_mil_laterales.sql
-- El rollup de la biblioteca dejaba de contar título por título.
--
-- LO MEDIDO, en producción el 18-sep-2026 con una biblioteca de 2.109 filas:
--
--     rpc_library_rollup  limit=1        406 ms
--     rpc_library_rollup  limit=1000    3314 ms
--     content-range                     0-0/2109
--
-- Y como el cliente la lee entera en ventanas de mil, encadenadas, /shows
-- tardaba 6,9 s en pintar el primer póster:
--
--     offset=0     t= 636  dur=3733 ms
--     offset=1000  t=4373  dur=2061 ms
--     offset=2000  t=6439  dur= 413 ms
--     primera imagen        t=6882
--
-- POR QUÉ. La definición venía arrastrando dos `left join lateral` desde 0022.
-- Una lateral se ejecuta UNA VEZ POR FILA de la izquierda: con 2.109 filas en la
-- biblioteca son 2.109 agregados sobre `episodes` y 2.109 cruces de
-- `watch_events` con `episodes`. El plan es correcto y el resultado también; lo
-- que no escala es el número de veces.
--
-- LO QUE CAMBIA. Las dos laterales pasan a ser agregados AGRUPADOS que se
-- calculan de una pasada y se enganchan por `title_id`. El trabajo deja de
-- multiplicarse por el tamaño de la biblioteca: `eps` recorre los episodios de
-- los títulos que sigues una vez, y `seen` recorre TUS eventos de visionado una
-- vez.
--
-- Los índices que lo sostienen ya existen, no hay que crear ninguno:
-- `episodes_title_air_idx (title_id, air_datetime)` desde 0002 y el UNIQUE
-- `watch_events (user_id, episode_id)` desde 0003.
--
-- LO QUE NO CAMBIA, y es lo que hay que mirar si algo se tuerce: ni una columna
-- del retorno, ni su orden, ni el criterio de ninguna. Es la misma respuesta
-- calculada de otra forma — comprobado fila a fila contra la definición vieja
-- con EXCEPT en los dos sentidos, sobre la pila local sembrada.
--
-- EL DETALLE QUE SÍ ES DISTINTO POR DENTRO, y por qué da igual: una lateral con
-- agregado devuelve SIEMPRE una fila —`count` 0 y NULL en los `max`/`min`—
-- mientras que un `group by` no devuelve nada para un título sin episodios, y el
-- LEFT JOIN pone NULL. Las dos formas acaban en el mismo número porque los dos
-- sitios donde eso se lee ya venían envueltos en `coalesce(..., 0)`. Si alguien
-- quita uno de esos coalesce, esto deja de ser cierto: un título sin episodios
-- pasaría de 0 a NULL.
--
-- Quien la toque después: `grep -n "create function public.rpc_library_rollup"
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
  with mine as (
    -- Tu biblioteca, una vez. `auth.uid()` entre paréntesis a propósito: así se
    -- evalúa una sola vez y no por fila, que es el mismo motivo por el que
    -- estaba así en el `where` de la definición vieja.
    select le.*
    from public.library_entries le
    where le.user_id = (select auth.uid()) and le.followed
  ),
  eps as materialized (
    -- Lo que antes era la lateral `a`. Acotado a los títulos que sigues: sin
    -- ese filtro esto recorrería la tabla de episodios ENTERA, que es de todo
    -- el mundo y no solo tuya.
    --
    -- `materialized` NO es decorativo, y es lo único de aquí que no se ve en el
    -- resultado. Sin él, Postgres puede meter este agregado dentro del bucle de
    -- la izquierda y volver a ejecutarlo por fila — con la base de pruebas
    -- vacía elegía exactamente eso: `GroupAggregate ... loops=7`. O sea, la
    -- lateral otra vez, con otra sintaxis. Con él se calcula una vez y punto.
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
    -- Lo que antes era la lateral `w`. Se acota por TU user_id, que es lo que
    -- lo hace barato: son tus eventos, no los de la tabla. `materialized` por
    -- lo mismo que arriba.
    select
      e2.title_id,
      count(*) as watched,
      max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where wv.user_id = (select auth.uid())
      and e2.season_number > 0
    group by e2.title_id
  )
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
  from mine le
  join public.titles t on t.id = le.title_id
  left join eps a on a.title_id = t.id
  left join seen w on w.title_id = t.id
$$;
grant execute on function public.rpc_library_rollup() to authenticated;
