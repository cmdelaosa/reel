-- 0069_cine_en_lo_compartido.sql
-- El cine entra en las tres pantallas que se comparten con las series.
--
-- 0067 las dejó filtradas a series, y lo dijo en su cabecera: no era el sitio
-- de una película en un muro, sino que las palabras del cine no existían aún.
-- «Un filtro no miente; una etiqueta prestada, sí». Ahora existen, así que el
-- filtro se levanta y cada función dice de qué medio habla.
--
--   * rpc_friend_activity — el muro pasa a llevar `kind` en cada evento. El
--     cliente pinta el glifo del medio y se calla la temporada y el episodio
--     cuando es una película. Devuelve jsonb, así que añadir un campo no cambia
--     el tipo de la función y no hace falta recrearla.
--   * rpc_watch_history — el historial igual, pero aquí `kind` es una columna
--     nueva del RETURNS TABLE, lo que sí cambia el tipo: drop y create.
--   * rpc_user_stats — las cifras se desdoblan en vez de mezclarse. Contar una
--     película como episodio era lo que hacía falsa la etiqueta, y juntarlas
--     bajo un nombre nuevo ("cosas vistas") habría perdido la única lectura que
--     alguien quiere de ahí. Dos números, cada uno con su nombre.
--
-- pending_new_episode_alerts se queda filtrada a series, y no por olvido: un
-- correo diciendo que una película "ya está disponible" el día de su estreno EN
-- CINE sería falso para quien la espera en casa, y decidir qué avisa (¿el
-- estreno en sala?, ¿la llegada a streaming?, ¿las dos?) es una decisión de
-- producto que nadie ha tomado. Hasta entonces, silencio.

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
           t.kind as kind,
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
           t.kind,
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
           t.kind,
           t.name, t.poster_path, null::int,
           f.from_season, f.from_episode, f.to_season, f.to_episode, f.ep_count,
           g.at, ('w:' || g.fid || ':' || g.title_id || ':' || to_char(g.day, 'YYYY-MM-DD'))
    from watched_window g
    join public.titles t on t.id = g.title_id
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
           u.verb, u.tmdb_id, u.kind, u.title_id, u.name as title_name, u.poster_path, u.score,
           u.season_number, u.episode_number, u.to_season, u.to_episode, u.ep_count,
           u.at, u.event_key
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;

-- ── historial ──────────────────────────────────────────────────────────────
-- Cuerpo idéntico salvo el filtro que se va y la columna `kind` que llega.
drop function if exists public.rpc_watch_history(int, timestamptz, uuid);
create function public.rpc_watch_history(
  p_limit int default 60,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  watch_event_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  kind text,
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
    t.kind,
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
    and (
      p_before is null
      or wv.watched_at < p_before
      or (wv.watched_at = p_before and wv.id < p_before_id)
    )
  order by wv.watched_at desc, wv.id desc
  limit greatest(1, least(p_limit, 200))
$$;
grant execute on function public.rpc_watch_history(int, timestamptz, uuid) to authenticated;

-- ── estadísticas del perfil ────────────────────────────────────────────────
drop function if exists public.rpc_user_stats();
create or replace function public.rpc_user_stats()
returns table (
  episodes_watched bigint,
  movies_watched bigint,
  minutes_watched bigint,
  shows_followed bigint,
  movies_followed bigint,
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
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and t.kind = 'movie'),
    -- Los minutos SÍ se suman: son minutos, y no cambian de unidad al cambiar
    -- de medio. Es la única cifra de esta función que puede juntar los dos sin
    -- decir nada falso, y separarla en dos relojes solo obligaría a sumarlos de
    -- cabeza. La duración de una película vive en episode_run_time igual que la
    -- de un episodio (0067); el 40 de respaldo solo lo tocan las series.
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid())
        and (t.kind = 'movie' or e.season_number > 0)),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'tv'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'movie'),
    -- "Por estrenar" junta los dos a propósito: la pregunta es "¿cuánto tengo
    -- esperando?", y esperar un estreno es lo mismo se llame temporada o
    -- película. La condición es la misma para ambos porque el episodio
    -- sintético la cumple igual: nada emitido todavía.
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped
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
grant execute on function public.rpc_user_stats() to authenticated;
