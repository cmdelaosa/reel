-- 0068_movie_release_dates.sql
-- Las DOS fechas de una película, y el feed de estrenos que las lee.
--
-- Una serie emite un episodio y ya está. Una película se estrena dos veces: en
-- cine y, meses después, en una plataforma — y para quien lleva una lista de
-- pendientes la segunda suele importar más que la primera. `first_air_date`
-- guarda una sola fecha (el `release_date` de TMDB, que es el estreno MUNDIAL,
-- ni siquiera el de tu país: Dune: Part Two lo tiene el 27-feb-2024 y en España
-- llegó a los cines el 1 de marzo), así que no puede contar esa historia.
--
-- ── Por país, como los proveedores ─────────────────────────────────────────
-- TMDB publica las fechas POR PAÍS y por tipo (3 = cine, 4 = digital), y el país
-- lo elige cada persona en Ajustes (ES/DE/CH). Guardar las de un solo país sería
-- mentirle a los otros dos, así que se guardan todas en jsonb y quien consulta
-- proyecta la suya — exactamente el trato que 0055 le dio a `providers`, por la
-- misma razón y con la misma forma:
--
--   {"ES": {"theatrical": "2024-03-01", "digital": "2024-05-21"},
--    "DE": {"theatrical": "2024-02-29"}}
--
-- Un país puede traer una de las dos, las dos o ninguna. Ninguna es el caso
-- normal en una película recién anunciada, y entonces el feed cae a
-- `first_air_date` como estreno sin tipo — que es lo único que se sabe.
--
-- `first_air_date` NO cambia y sigue mandando en lo demás: es lo que el trigger
-- de 0067 pone en el episodio sintético, y por tanto lo que decide si la
-- película cuenta como estrenada (Sin empezar vs Próximas). Estas dos columnas
-- son para el calendario, no para el estado.

alter table public.titles add column if not exists release_dates jsonb;

comment on column public.titles.release_dates is
  'Fechas de estreno por país y tipo, {"ES": {"theatrical": …, "digital": …}}, '
  'de TMDB /movie/:id?append_to_response=release_dates. Null en series. '
  'Proyectada por país en rpc_movie_releases; ver supabase/functions/tmdb-proxy.';

-- ============================================================
-- rpc_movie_releases — el feed de estrenos de TUS películas
-- ============================================================
-- Una fila por ESTRENO, no por película: la que tiene fecha de cine y de
-- streaming sale dos veces, que es justo lo que se quiere ver en un calendario
-- ("esta la puedo ver ya en casa" es otro evento que "esta llega a los cines").
--
-- `release_kind` dice cuál de los dos es, y vale 'release' cuando no se sabe:
-- sin datos del país no se puede afirmar que un estreno fue en cine, y llamarlo
-- así por defecto convertiría en sala cualquier película de plataforma.
--
-- Se emite en el mismo formato que rpc_calendar_feed sirve los episodios
-- (instante en timestamptz, no fecha suelta) para que el cliente pueda agrupar
-- las dos cosas con el mismo código de días. Y a la misma hora que el episodio
-- sintético: 00:00 UTC, que en todo el huso CET cae en el día correcto.
create or replace function public.rpc_movie_releases(
  p_country text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  title_id uuid,
  tmdb_id int,
  name text,
  poster_path text,
  genres text[],
  runtime int,
  vote_average numeric,
  release_kind text,
  release_at timestamptz,
  watch_event_id uuid
)
language sql
security invoker
stable
as $$
  with mine as (
    select t.id, t.tmdb_id, t.name, t.poster_path, t.genres,
           t.episode_run_time as runtime, t.vote_average,
           t.first_air_date,
           t.release_dates -> p_country as here
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    where le.user_id = (select auth.uid())
      and le.followed
      and not le.stopped
      and t.kind = 'movie'
  ),
  events as (
    -- Las dos fechas del país, cada una por su lado…
    select m.*, 'theatrical' as release_kind, (m.here ->> 'theatrical')::date as day
    from mine m where m.here ->> 'theatrical' is not null
    union all
    select m.*, 'digital', (m.here ->> 'digital')::date
    from mine m where m.here ->> 'digital' is not null
    union all
    -- …y el respaldo, solo para las que no tienen NINGUNA de las dos: sin él,
    -- una película recién anunciada desaparecería del calendario entero.
    select m.*, 'release', m.first_air_date
    from mine m
    where m.first_air_date is not null
      and coalesce(m.here ->> 'theatrical', m.here ->> 'digital') is null
  )
  select
    e.id, e.tmdb_id, e.name, e.poster_path, e.genres, e.runtime, e.vote_average,
    e.release_kind,
    (e.day::timestamp at time zone 'UTC') as release_at,
    wv.id
  from events e
  -- El visto cuelga del episodio sintético, que es uno por película: las dos
  -- filas de una misma peli comparten marca, y así debe ser — la has visto o no,
  -- no "la has visto en cine".
  left join public.episodes ep on ep.title_id = e.id
  left join public.watch_events wv
    on wv.episode_id = ep.id and wv.user_id = (select auth.uid())
  where (e.day::timestamp at time zone 'UTC') >= p_from
    and (e.day::timestamp at time zone 'UTC') <= p_to
  order by 9, e.name
$$;

grant execute on function public.rpc_movie_releases(text, timestamptz, timestamptz) to authenticated;
