-- 0079_friend_explore_por_medio.sql
-- Los dos carriles de amigos de Explorar pasan a filtrar por MEDIO. Hasta hoy
-- no filtraban por nada, y eso era un fallo silencioso desde que el segundo
-- medio entró en la app.
--
-- ── Lo que pasaba ─────────────────────────────────────────────────────────
-- `rpc_popular_with_friends` (0043) y `rpc_best_rated_by_friends` (0035) nacieron
-- cuando en `titles` solo había series, así que preguntar por el medio habría
-- sido preguntar por algo que no variaba. Desde 0067 y 0071 sí varía, y ninguna
-- de las dos se enteró:
--
--   * VIVO: un amigo termina un juego → su `watch_event` cae sobre el episodio
--     sintético, que 0067 numera (1, 1), así que el `season_number > 0` de 0043
--     no lo para: entra en "Popular entre tus amigos" DEL MODO SERIES, con su
--     carátula de juego, en una rejilla donde todo lo demás son series. Esta
--     RPC la llama el cliente hoy (lib/explore.ts), así que el fallo está en
--     producción esperando a que alguien puntúe fuera de las series.
--   * LATENTE: lo mismo en `rpc_best_rated_by_friends` con las notas, salvo que
--     a esa no la llama nadie desde que las KPIs se llevaron su sitio. Se
--     arregla igual porque en esta misma rama vuelve al servicio: es el carril
--     "Mejor valoradas por tus amigos" del modo cine.
--
-- No rompía nada —los datos son reales y la ficha abre bien—, y por eso llevaba
-- meses sin verse: es una fila correcta en la pantalla equivocada.
--
-- ── La forma ──────────────────────────────────────────────────────────────
-- Un parámetro `p_kind` con 'tv' por defecto. El defecto no es pereza: deja que
-- el cliente que ya está desplegado —que llama sin argumentos— siga viendo
-- exactamente lo que veía, y lo que veía era el modo series. Así esta migración
-- se puede aplicar ANTES de que salga el frontend sin una ventana rara en medio,
-- que es el orden que pide docs/DEPLOY.md.
--
-- Hay que DROP antes del CREATE: en Postgres una lista de argumentos distinta es
-- otra función, así que un `create or replace` con el parámetro nuevo dejaría
-- viva también la versión sin argumentos, y las llamadas sin argumentos seguirían
-- yendo a la vieja. El fallo sobreviviría a su propio arreglo.

drop function if exists public.rpc_popular_with_friends();
drop function if exists public.rpc_best_rated_by_friends();

create or replace function public.rpc_popular_with_friends(p_kind text default 'tv')
returns jsonb
language sql
security invoker
stable
as $$
  with my_friends as (
    select case when f.a = (select auth.uid()) then f.b else f.a end as fid
    from public.friendships f
    where f.status = 'accepted' and (select auth.uid()) in (f.a, f.b)
  ),
  fw as (
    select e.title_id, p.id as fid, p.display_name, p.avatar_url,
           max(wv.watched_at) as last_watch
    from my_friends mf
    join public.watch_events wv on wv.user_id = mf.fid
    join public.episodes e on e.id = wv.episode_id and e.season_number > 0
    join public.titles t0 on t0.id = e.title_id and t0.kind = p_kind
    join public.profiles p on p.id = mf.fid
    group by e.title_id, p.id, p.display_name, p.avatar_url
  ),
  agg as (
    select title_id, count(*) as cnt, max(last_watch) as last_watch,
           jsonb_agg(jsonb_build_object('id', fid, 'name', display_name, 'avatar_url', avatar_url)
                     order by last_watch desc) as friends
    from fw group by title_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'tmdb_id', t.tmdb_id, 'name', t.name, 'poster_path', t.poster_path, 'network', t.network,
    'first_air_date', t.first_air_date, 'genres', t.genres, 'vote_average', t.vote_average,
    'count', a.cnt, 'friends', a.friends,
    'i_follow', exists (select 1 from public.library_entries le2
                        where le2.user_id = (select auth.uid()) and le2.title_id = t.id and le2.followed)
  ) order by a.cnt desc, a.last_watch desc), '[]'::jsonb)
  from agg a join public.titles t on t.id = a.title_id;
$$;

-- La de notas no mira `watch_events` sino `ratings`, y ahí el medio se pregunta
-- una sola vez, en el join con titles. `r.title_id is not null` sigue siendo la
-- línea que deja fuera las notas por EPISODIO: son de otra granularidad y
-- mezclarlas con las de la obra entera daría medias sin significado.
create or replace function public.rpc_best_rated_by_friends(p_kind text default 'tv')
returns jsonb
language sql
security invoker
stable
as $$
  with my_friends as (
    select case when f.a = (select auth.uid()) then f.b else f.a end as fid
    from public.friendships f
    where f.status = 'accepted' and (select auth.uid()) in (f.a, f.b)
  ),
  fr as (
    select r.title_id, r.score, p.id as fid, p.display_name, p.avatar_url
    from my_friends mf
    join public.ratings r on r.user_id = mf.fid and r.title_id is not null
    join public.titles t0 on t0.id = r.title_id and t0.kind = p_kind
    join public.profiles p on p.id = mf.fid
  ),
  agg as (
    select title_id, round(avg(score)::numeric, 1) as avg_score, count(*) as cnt,
           jsonb_agg(jsonb_build_object('id', fid, 'name', display_name, 'avatar_url', avatar_url, 'score', score)) as raters
    from fr group by title_id having count(*) >= 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'tmdb_id', t.tmdb_id, 'name', t.name, 'poster_path', t.poster_path, 'network', t.network,
    'first_air_date', t.first_air_date, 'genres', t.genres, 'vote_average', t.vote_average,
    'avg_score', a.avg_score, 'count', a.cnt, 'raters', a.raters,
    'i_follow', exists (select 1 from public.library_entries le2
                        where le2.user_id = (select auth.uid()) and le2.title_id = t.id and le2.followed)
  ) order by a.avg_score desc, a.cnt desc), '[]'::jsonb)
  from agg a join public.titles t on t.id = a.title_id;
$$;

grant execute on function public.rpc_popular_with_friends(text) to authenticated;
grant execute on function public.rpc_best_rated_by_friends(text) to authenticated;
