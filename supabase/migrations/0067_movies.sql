-- 0067_movies.sql
-- Películas: el modo Movies, en la capa de datos.
--
-- `titles` nació movie-ready — kind ya admite 'movie' desde 0002 — pero nada
-- más lo estaba. Esta migración cierra las tres grietas que impedían guardar
-- una película, y no toca una sola de las 27 funciones que leen watch_events.
--
-- ── 1. El espacio de ids no era único ───────────────────────────────────────
-- titles.tmdb_id era UNIQUE a secas, y los ids de TMDB están namespaced por
-- medio: /tv/1399 es Juego de Tronos y /movie/1399 es una película húngara de
-- 1978. Con la restricción vieja, la primera de las dos en llegar se quedaba la
-- fila y la segunda la SOBRESCRIBÍA — un upsert por tmdb_id no puede distinguir
-- lo que la clave no distingue. Pasa a ser UNIQUE (kind, tmdb_id), que es la
-- identidad real de un título en TMDB.
--
-- ── 2. Una peli vista no tenía dónde escribirse ─────────────────────────────
-- watch_events.episode_id es NOT NULL REFERENCES episodes: ver algo es, en este
-- esquema, ver un episodio. En vez de añadir una segunda forma de "visto" (y
-- una rama por medio en rollup, up_next, historial, heatmap, stats, actividad
-- de amigos, mark_up_to y mark_series), cada película mantiene UN episodio
-- sintético S1E1 con su fecha de estreno. Lo escribe el trigger de abajo, no
-- las funciones edge, para que valga igual para el importador, el seed y
-- cualquier escritor futuro.
--
-- Lo que sale gratis por hacerlo así, sin tocar nada:
--   * deriveStatus (app/src/domain/status.ts) ya da los cuatro estados que
--     tiene una película: 0 emitidos → upcoming, 0 vistos → watchlist,
--     1 de 1 → vista. No hay "a medias" porque no puede haberlo con un episodio.
--   * rpc_up_next las excluye SOLA: con 0 vistos falla su `c.watched > 0`, y
--     con 1 visto no queda episodio pendiente que devolver. Aun así el filtro
--     por kind va explícito abajo — que hoy funcione por aritmética no es lo
--     mismo que decir en voz alta que Tonight es de series.
--   * el marcado, el historial, las notas, el export y el muro de amigos
--     funcionan sin enterarse de que existe el cine.
--
-- El precio, dicho claro: `episodes` guarda filas que no son episodios, y toda
-- consulta que sea de series tiene que filtrar por kind — que es justo lo que
-- el modo TV/Movies quiere hacer de todas formas.
--
-- ── 3. Las vistas de series mezclaban medios ────────────────────────────────
-- rpc_calendar_feed no filtraba por kind porque no hacía falta: no había otro.
-- Con el episodio sintético, una peli seguida aparecería en el calendario de
-- series entre dos episodios. Se le pone el filtro, y de paso a rpc_up_next.

-- ── 4. La saga ─────────────────────────────────────────────────────────────
-- Lo que en una serie son las temporadas, en el cine es la saga: la lista de
-- entregas por las que se navega desde la ficha. TMDB la publica como
-- `belongs_to_collection` en el detalle de cada película, así que las dos
-- columnas de abajo guardan a cuál pertenece — y `collection_id` es lo que la
-- ruta /movie/:id/saga usa para traer las hermanas.

-- ============================================================
-- 1. Identidad de un título: (kind, tmdb_id)
-- ============================================================
-- El nombre de la restricción vieja lo puso Postgres al declarar la columna
-- UNIQUE en 0002, así que es el implícito: titles_tmdb_id_key.
alter table public.titles drop constraint if exists titles_tmdb_id_key;
alter table public.titles add constraint titles_kind_tmdb_id_key unique (kind, tmdb_id);

-- La saga a la que pertenece una película (TMDB: belongs_to_collection). Null
-- en series y en las películas sueltas, que son la mayoría.
alter table public.titles add column if not exists collection_id int;
alter table public.titles add column if not exists collection_name text;
-- "Las otras entregas de esta saga" es la consulta que hace la ficha, y sin
-- índice recorre la tabla entera de títulos por cada película que se abre.
create index if not exists titles_collection_idx
  on public.titles (collection_id) where collection_id is not null;

-- ============================================================
-- 2. El episodio sintético de cada película
-- ============================================================
-- Un episodio S1E1 por película, con su fecha de estreno, mantenido en pie por
-- el trigger de abajo.
--
-- La hora: 00:00 UTC del día de estreno, no el marcador de las 21:00 que
-- llevan los episodios sin hora real (AIR_TIME en tmdb-proxy). Un episodio con
-- el marcador se considera emitido a partir de esa hora, que para una serie da
-- igual — nadie mira si un episodio de hoy ya salió a las 19:00. Una película
-- estrenada hoy, en cambio, tiene que contar como estrenada desde primera hora,
-- o el día del estreno la ficha diría "aún no". A 00:00 UTC el día se lee bien
-- en todo el huso CET, que es el único que el selector de país admite
-- (ES/DE/CH — ver app/src/lib/region.ts).
--
-- air_time_source = 'estimated' a propósito: es lo que hace que la UI imprima
-- la fecha sin hora (hasRealAirTime), y un estreno en cine no tiene hora.
create or replace function public.movie_episode_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'movie' then
    return new;
  end if;

  insert into public.episodes (
    title_id, season_number, episode_number, name, overview, runtime,
    air_date, air_datetime, air_time_source
  )
  values (
    new.id, 1, 1, new.name, new.overview, new.episode_run_time,
    new.first_air_date,
    case when new.first_air_date is null then null
         else (new.first_air_date::timestamp at time zone 'UTC') end,
    'estimated'
  )
  on conflict (title_id, season_number, episode_number) do update
    -- El nombre y la sinopsis siguen a los del título; la fecha también, porque
    -- un estreno se mueve y lo que cuenta como estrenado tiene que moverse con
    -- él. Nada más se toca: las notas de IMDb/TMDB que el importador escriba
    -- sobre esta fila son suyas.
    set name         = excluded.name,
        overview     = excluded.overview,
        runtime      = excluded.runtime,
        air_date     = excluded.air_date,
        air_datetime = excluded.air_datetime;

  return new;
end;
$$;

-- AFTER, no BEFORE: la fila de episodes referencia titles.id, que en un INSERT
-- BEFORE todavía no existe para la FK.
--
-- Sin `when (new.kind = 'movie')` en el trigger: el filtro vive dentro de la
-- función para que un título que CAMBIA a movie (no debería pasar, pero el
-- check lo permite) también acabe con su episodio.
drop trigger if exists movie_episode_sync on public.titles;
create trigger movie_episode_sync
  after insert or update of name, overview, episode_run_time, first_air_date, kind
  on public.titles
  for each row
  execute function public.movie_episode_sync();

-- Las películas que ya estuvieran guardadas (ninguna hoy, pero la migración no
-- puede dar por hecho el contenido de la base) reciben su episodio ahora.
update public.titles set kind = kind where kind = 'movie';

-- ============================================================
-- 3. Las vistas de series, explícitamente de series
-- ============================================================
-- Cuerpo idéntico al de 0051 salvo el `t.kind = 'tv'`.
drop function if exists public.rpc_calendar_feed(timestamptz, timestamptz);
create function public.rpc_calendar_feed(p_from timestamptz, p_to timestamptz)
returns table (
  episode_id uuid, title_id uuid, tmdb_id int, show_name text, poster_path text,
  network text, season_number int, episode_number int, episode_name text,
  air_datetime timestamptz, air_time_source text, is_premiere boolean,
  is_finale boolean, watch_event_id uuid
)
language sql
security invoker
stable
as $$
  select
    e.id, t.id, t.tmdb_id, t.name, t.poster_path, t.network,
    e.season_number, e.episode_number, e.name, e.air_datetime, e.air_time_source,
    e.episode_number = 1 as is_premiere,
    e.episode_number = season_last.max_ep as is_finale,
    wv.id
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join public.episodes e
    on e.title_id = t.id
   and e.season_number > 0
   and e.air_datetime is not null
   and e.air_datetime >= p_from
   and e.air_datetime <= p_to
  join lateral (
    select max(e3.episode_number) as max_ep
    from public.episodes e3
    where e3.title_id = e.title_id and e3.season_number = e.season_number
  ) season_last on true
  left join public.watch_events wv
    on wv.episode_id = e.id and wv.user_id = (select auth.uid())
  where le.user_id = (select auth.uid())
    and le.followed
    and not le.stopped
    and t.kind = 'tv'
  order by e.air_datetime, t.name, e.episode_number
$$;
grant execute on function public.rpc_calendar_feed(timestamptz, timestamptz) to authenticated;

-- Cuerpo idéntico al de 0049 salvo el `t.kind = 'tv'`.
drop function if exists public.rpc_up_next();
create function public.rpc_up_next()
returns table (
  title_id uuid, tmdb_id int, name text, poster_path text, backdrop_path text,
  network text, vote_average numeric, episode_id uuid, season_number int,
  episode_number int, episode_name text, runtime int, air_datetime timestamptz,
  aired_count int, watched_count int, last_watched_at timestamptz
)
language sql
security invoker
stable
as $$
  select
    t.id, t.tmdb_id, t.name, t.poster_path, t.backdrop_path, t.network, t.vote_average,
    n.id, n.season_number, n.episode_number, n.name,
    coalesce(n.runtime, t.episode_run_time), n.air_datetime,
    c.aired::int, c.watched::int, c.last_watched_at
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join lateral (
    select e.id, e.season_number, e.episode_number, e.name, e.runtime, e.air_datetime
    from public.episodes e
    where e.title_id = t.id
      and e.season_number > 0
      and e.air_datetime is not null
      and e.air_datetime <= now()
      and not exists (
        select 1 from public.watch_events wv
        where wv.user_id = (select auth.uid()) and wv.episode_id = e.id
      )
    order by e.season_number, e.episode_number
    limit 1
  ) n on true
  join lateral (
    select
      count(*) filter (where e2.air_datetime <= now() and e2.season_number > 0) as aired,
      count(*) filter (where wv.id is not null) as watched,
      max(wv.watched_at) as last_watched_at
    from public.episodes e2
    left join public.watch_events wv
      on wv.episode_id = e2.id and wv.user_id = (select auth.uid()) and e2.season_number > 0
    where e2.title_id = t.id
  ) c on true
  where le.user_id = (select auth.uid())
    and le.followed
    and not le.stopped
    and t.kind = 'tv'
    and c.watched > 0
$$;
grant execute on function public.rpc_up_next() to authenticated;

-- ============================================================
-- 4. rpc_library_rollup devuelve el medio
-- ============================================================
-- La biblioteca es una sola tabla para los dos modos; quien la lee decide qué
-- mitad enseña. Cuerpo idéntico al de 0037 salvo la columna `kind`.
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
  upcoming_season_air_date date
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
    t.upcoming_season_air_date
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
    select count(*) as watched, max(we.watched_at) as last_watched_at
    from public.watch_events we
    join public.episodes e2 on e2.id = we.episode_id
    where we.user_id = (select auth.uid())
      and e2.title_id = t.id
      and e2.season_number > 0
  ) w on true
  where le.user_id = (select auth.uid())
    and le.followed
$$;
grant execute on function public.rpc_library_rollup() to authenticated;

-- ============================================================
-- 5. Las superficies que hablan de episodios, solo de episodios
-- ============================================================
-- El episodio sintético es un episodio para cualquier consulta que no pregunte
-- por el medio, y hay cinco que no preguntaban porque hasta ahora no hacía
-- falta. Ninguna se rompe: las cinco dicen algo FALSO, que es peor.
--
--   * pending_new_episode_alerts — la que sale del navegador. Una película
--     seguida entra por la rama "nada de este título había emitido aún" el día
--     de su estreno, y el cron manda inbox y correo diciendo que ya está
--     disponible «S1 · E1». Un aviso equivocado por email no se puede retirar.
--   * rpc_watch_history — el historial pinta cada fila como «S01 · E01»
--     (HistoryEpRow), así que una película vista sale disfrazada de episodio.
--   * rpc_friend_activity — el muro publicaría «Vio Dune: Part Two S1 · E1».
--     Solo la rama de VISTOS: las de puntuar y añadir no imprimen temporada ni
--     episodio, y una película puntuada en el muro está bien como está.
--   * rpc_user_stats — «Episodes watched» y «Shows followed» dejarían de ser
--     ciertas, y «coming soon» contaría como estreno pendiente cada película
--     futura de tu lista.
--
-- Se filtran a series en vez de enseñarlas con las palabras del cine porque esas
-- palabras no existen todavía: el muro con glifo de medio, el historial de cine
-- y las estadísticas de películas se diseñan en la rama del feed integrado. Un
-- filtro no miente; una etiqueta prestada, sí.
--
-- Los cuatro cuerpos son copias literales de su última definición (0059, 0024,
-- 0058 y 0022) con esa única línea añadida, y `create or replace` basta porque
-- ninguno cambia de tipo de retorno.

create or replace function public.pending_new_episode_alerts()
returns table (
  user_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  season_number int,
  episode_number int,
  episode_name text
)
language sql
security invoker
stable
as $$
  select le.user_id, e.id, t.id, t.tmdb_id, t.name, e.season_number, e.episode_number, e.name
  from public.episodes e
  join public.titles t on t.id = e.title_id
  join public.library_entries le on le.title_id = t.id and le.followed
  where e.season_number > 0
    and t.kind = 'tv'
    and e.air_datetime > now() - interval '24 hours'
    and e.air_datetime <= now()
    and not le.stopped
    and (
      -- watching / caught up: the user has started this show
      exists (
        select 1
        from public.watch_events we
        join public.episodes we_e on we_e.id = we.episode_id
        where we.user_id = le.user_id
          and we_e.title_id = t.id
          and we_e.season_number > 0
      )
      -- upcoming: nothing of this show had aired yet, so this is the premiere
      or not exists (
        select 1
        from public.episodes e2
        where e2.title_id = t.id
          and e2.season_number > 0
          and e2.air_datetime < e.air_datetime
          and e2.air_datetime <= now()
      )
    )
    and not exists (
      select 1 from public.notifications_sent ns
      where ns.user_id = le.user_id and ns.episode_id = e.id
    )
$$;

create or replace function public.rpc_user_stats()
returns table (
  episodes_watched bigint,
  minutes_watched bigint,
  shows_followed bigint,
  coming_soon bigint,
  avg_rating numeric,
  friends bigint
)
language sql
security invoker
stable
as $$
  select
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and e.season_number > 0 and t.kind = 'tv'),
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and e.season_number > 0 and t.kind = 'tv'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'tv'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'tv'
        and not exists (
          select 1 from public.episodes e
          where e.title_id = le.title_id
            and e.season_number > 0
            and e.air_datetime <= now())),
    (select round(avg(r.score)::numeric, 1)
       from public.ratings r
      where r.user_id = (select auth.uid())),
    (select count(*)
       from public.friendships f
      where f.status = 'accepted'
        and (select auth.uid()) in (f.a, f.b))
$$;

create or replace function public.rpc_watch_history(
  p_limit int default 60,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  watch_event_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  poster_path text,
  network text,
  season_number int,
  episode_number int,
  episode_name text,
  watched_at timestamptz,
  source text
)
language sql
security invoker
stable
as $$
  select
    wv.id,
    e.id,
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.network,
    e.season_number,
    e.episode_number,
    e.name,
    wv.watched_at,
    wv.source
  from public.watch_events wv
  join public.episodes e on e.id = wv.episode_id
  join public.titles t on t.id = e.title_id
  where wv.user_id = (select auth.uid())
    and t.kind = 'tv'
    and (
      p_before is null
      or wv.watched_at < p_before
      or (wv.watched_at = p_before and wv.id < p_before_id)
    )
  order by wv.watched_at desc, wv.id desc
  limit greatest(1, least(p_limit, 200))
$$;

create or replace function public.rpc_friend_activity(p_limit int default 30)
returns jsonb
language sql
security invoker
stable
as $$
  with circle as (
    select case when f.a = (select auth.uid()) then f.b else f.a end as fid
    from public.friendships f
    where f.status = 'accepted' and (select auth.uid()) in (f.a, f.b)
    union
    select (select auth.uid())
  ),
  -- Every source takes its rows per circle member, not from one global window:
  -- one person marking a 500-episode show watched must not evict everyone else
  -- from the feed.
  rated as (
    select x.fid as fid, 'rated' as verb, x.title_id as title_id, t.tmdb_id as tmdb_id,
           t.name as name, t.poster_path as poster_path, x.score as score,
           null::int as season_number, null::int as episode_number,
           null::int as to_season, null::int as to_episode, 1 as ep_count,
           x.at as at, ('r:' || x.fid || ':' || x.title_id) as event_key
    from circle c
    cross join lateral (
      select c.fid as fid, rr.title_id as title_id, rr.score::int as score, rr.created_at as at
      from public.ratings rr
      where rr.user_id = c.fid and rr.title_id is not null
      order by rr.created_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  added as (
    select x.fid, 'added', x.title_id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           null::int, null::int, null::int, null::int, 1,
           x.at, ('a:' || x.fid || ':' || x.title_id)
    from circle c
    cross join lateral (
      select c.fid as fid, le.title_id as title_id, le.added_at as at
      from public.library_entries le
      where le.user_id = c.fid and le.followed
      order by le.added_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  -- Two stages for the bursts: a bounded window to DISCOVER which (person,
  -- show, day) rows are recent…
  watched_window as (
    select w.fid, w.title_id, w.day, max(w.watched_at) as at
    from circle c
    cross join lateral (
      select c.fid as fid, e.title_id as title_id, wv.watched_at as watched_at,
             (wv.watched_at at time zone 'Europe/Madrid')::date as day
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = c.fid
      order by wv.watched_at desc
      limit p_limit * 8
    ) w
    group by w.fid, w.title_id, w.day
    order by max(w.watched_at) desc
    limit p_limit
  ),
  -- …then an exact count over the WHOLE day for the few rows that survive.
  -- Counting inside the discovery window instead would report "E7–E12 · 6" for
  -- a twelve-episode day whenever the window happened to cut it in half.
  watched as (
    select g.fid, 'watched', g.title_id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           f.from_season, f.from_episode, f.to_season, f.to_episode, f.ep_count,
           g.at, ('w:' || g.fid || ':' || g.title_id || ':' || to_char(g.day, 'YYYY-MM-DD'))
    from watched_window g
    join public.titles t on t.id = g.title_id and t.kind = 'tv'
    cross join lateral (
      select (array_agg(e.season_number  order by e.season_number, e.episode_number))[1] as from_season,
             (array_agg(e.episode_number order by e.season_number, e.episode_number))[1] as from_episode,
             (array_agg(e.season_number  order by e.season_number desc, e.episode_number desc))[1] as to_season,
             (array_agg(e.episode_number order by e.season_number desc, e.episode_number desc))[1] as to_episode,
             count(*)::int as ep_count
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = g.fid
        and e.title_id = g.title_id
        and wv.watched_at >= (g.day::timestamp at time zone 'Europe/Madrid')
        and wv.watched_at <  ((g.day + 1)::timestamp at time zone 'Europe/Madrid')
    ) f
  ),
  unioned as (
    select * from rated
    union all select * from added
    union all select * from watched
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  from (
    select p.id as friend_id, p.display_name as friend_name, p.avatar_url as friend_avatar,
           u.verb, u.tmdb_id, u.title_id, u.name as title_name, u.poster_path, u.score,
           u.season_number, u.episode_number, u.to_season, u.to_episode, u.ep_count,
           u.at, u.event_key
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;
