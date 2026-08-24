-- 0074_juegos_en_lo_compartido.sql
-- Los videojuegos entran en el muro y en el historial. Gemela de 0069, que hizo
-- lo mismo con el cine, y con la misma estructura: se levanta un filtro que
-- 0071 puso a propósito y que dejó dicho cuándo tocaba levantarlo.
--
-- 0071, sección 9, separó lo temporal de lo permanente y esta migración se
-- limita a hacer lo que allí quedó escrito:
--
--   * rpc_friend_activity y rpc_watch_history — TEMPORALES. «Un filtro no
--     miente; una etiqueta prestada, sí»: los juegos quedaron fuera porque
--     "Vio Silksong S1 · E1" es la etiqueta de las series puesta sobre otra
--     cosa. Las palabras ya existen (app/src/domain/mediumCopy.ts, con sus
--     tests) y el glifo del mando también, así que el filtro se va.
--   * rpc_user_stats.minutes_watched — PERMANENTE, y aquí no se toca. Un juego
--     no dura cuarenta minutos y no los durará nunca. Lo que sí llega es su
--     propia cifra, `minutes_played`, en paralelo y no sumada — el mismo
--     desdoblamiento con el que 0069 separó `episodes_watched` de
--     `movies_watched` en vez de mezclarlos bajo un nombre nuevo.
--
-- ── Qué publica un juego en el muro, y qué no ──────────────────────────────
-- Esta es la decisión de producto de esta migración, así que va escrita entera.
--
-- El muro tiene tres fuentes, y las tres son filas con fecha en una tabla:
-- `ratings.created_at`, `library_entries.added_at` y `watch_events.watched_at`.
-- Traducidas al tercer medio:
--
--   * PUNTUARLO   — igual que en los otros dos. Un 9 es un 9.
--   * AÑADIRLO    — "añadió Silksong a sus pendientes". La lista se llama de
--                   otra forma en juegos (el cubo es Backlog / "Pendientes"),
--                   y esa es toda la diferencia con el cine.
--   * TERMINARLO  — el watch_event del episodio sintético. En cine ese evento
--                   se lee "vio"; aquí se lee "terminó", que es literalmente
--                   lo que 0073 dice que significa: te salieron los créditos.
--
-- Lo que NO se publica, y por qué no es un olvido:
--
--   * EMPEZARLO. Sería el paso a play_state='playing', y no hay CUÁNDO: la
--     columna guarda el estado, no el instante en que cambió. Publicarlo
--     obligaría a inventarse una fecha (¿added_at? ¿now()?) y una fila del
--     muro con fecha inventada se ordena mal para siempre. Además, en el caso
--     normal "añadir" y "empezar" ocurren con minutos de diferencia —se mete un
--     juego en Reel porque se acaba de empezar—, así que el muro estaría
--     diciendo dos veces lo mismo. El día que exista una columna con la fecha
--     del cambio, esto se reabre; hasta entonces, silencio.
--
--   * UN SALTO DE HORAS. `minutes_played` es un contador, no un historial: no
--     hay forma de saber cuánto subió ni cuándo. Y aunque la hubiera, es
--     justamente la clase de evento que el muro pliega desde 0058 — el mismo
--     título de la misma persona repitiéndose cada tarde es lo que aquel
--     agrupado por (persona, título, día) existe para evitar.
--
-- ── El sitio del filtro, que aquí importa al revés ─────────────────────────
-- 0071 dejó anotado que el filtro tenía que ir DENTRO de las tres subconsultas
-- laterales y antes de su LIMIT, porque cada fuente coge las p_limit filas más
-- recientes POR PERSONA: filtrando al final, un amigo con treinta juegos gasta
-- su cupo en filas que se descartan después y su actividad de series desaparece
-- del muro sin que nada lo diga.
--
-- Al levantarlo pasa lo contrario y conviene verlo: los tres joins con `titles`
-- que 0071 añadió se van enteros, y el cuerpo vuelve a ser exactamente el de
-- 0069. No queda ningún filtro por medio, así que no queda ningún cupo que
-- gastar — que es la forma de comprobar que se han quitado los tres y no dos.

-- ── el muro ────────────────────────────────────────────────────────────────
-- Devuelve jsonb, así que `kind` ya viaja desde 0069 y no hay tipo que cambiar:
-- basta el create or replace. El cliente pinta el glifo del medio y elige la
-- frase; lo único que esta función hace distinto es dejar pasar las filas.
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

-- ── el historial ───────────────────────────────────────────────────────────
-- Se va la condición y ya está: misma firma, mismas columnas, create or replace.
-- La fila de un juego llega con season_number = 1 y episode_number = 1, como la
-- de una película, y el cliente NO los imprime — historyLines('game') manda el
-- título arriba y el estudio debajo, igual que en cine. Aquí no se puede
-- comprobar; por eso esa decisión vive en un módulo puro con tests al lado.
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

-- ── las estadísticas ───────────────────────────────────────────────────────
-- Tres cifras nuevas y ni una suma nueva. El criterio es el de 0069 dicho para
-- el tercer medio: se juntan dos medios cuando la unidad es la misma y la
-- pregunta también, y se desdoblan cuando no.
--
--   games_finished — juegos con los créditos vistos. No entra en
--     `episodes_watched` (no es un episodio) ni en `movies_watched` (no es una
--     película): es su propia cuenta, como lo fue la del cine.
--   games_followed — el gemelo de shows_followed y movies_followed.
--   minutes_played — el reloj de los juegos, APARTE de minutes_watched. Esta es
--     la cifra que 0071 declaró permanente y por la que dejó a los juegos fuera
--     de aquella suma: `coalesce(e.runtime, t.episode_run_time, 40)` le habría
--     añadido cuarenta minutos inventados a cada juego marcado.
--
-- `minutes_played` NO filtra por `followed`, y es deliberado: es el paralelo
-- exacto de minutes_watched, que cuenta watch_events aunque el título ya no
-- esté en la biblioteca. El tiempo que jugaste lo jugaste, y quitar un juego de
-- la lista no te lo devuelve.
--
-- `minutes_watched` se queda EXACTAMENTE como estaba, con su filtro positivo
-- nombrando los dos medios que miden en minutos. Que siga siendo `t.kind in
-- ('tv','movie')` y no un `<> 'game'` es lo que hará que el cuarto medio, si
-- alguna vez lo hay, herede la exclusión gratis en vez de sumar basura.
--
-- `coming_soon` sigue contando los tres, que es lo que 0071 ya dejó dicho: la
-- pregunta es «¿cuánto tengo esperando?», y esperar un lanzamiento es lo mismo
-- se llame temporada, película o juego.
drop function if exists public.rpc_user_stats();
create or replace function public.rpc_user_stats()
returns table (
  episodes_watched bigint,
  movies_watched bigint,
  games_finished bigint,
  minutes_watched bigint,
  minutes_played bigint,
  shows_followed bigint,
  movies_followed bigint,
  games_followed bigint,
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
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and t.kind = 'game'),
    -- Los minutos de lo que se VE. Series y cine sí se suman: son minutos, y no
    -- cambian de unidad al cambiar de medio. La duración de una película vive
    -- en episode_run_time igual que la de un episodio (0067); el 40 de respaldo
    -- solo lo tocan las series.
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid())
        and (t.kind = 'movie' or (t.kind = 'tv' and e.season_number > 0))),
    -- Y los minutos de lo que se JUEGA, que no salen de un runtime sino de lo
    -- que la persona escribió a mano (0073).
    (select coalesce(sum(le.minutes_played), 0)::bigint
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and t.kind = 'game'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'tv'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'movie'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'game'),
    -- "Por estrenar" junta los tres a propósito: la pregunta es "¿cuánto tengo
    -- esperando?", y esperar un estreno es lo mismo se llame temporada,
    -- película o juego. La condición vale para los tres porque el episodio
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
