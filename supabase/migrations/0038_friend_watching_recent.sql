-- 0038_friend_watching_recent.sql
-- Friend "watching now" v2 + per-show friend progress.
--
-- 1. rpc_friend_snapshot's `watching` used to be alphabetical and included any
--    show with at least one watch — so years-old half-finished shows sat there
--    forever. Now it's the shows they *actually* have in rotation: ordered by
--    their last watch (most recent first) and dropped once the last watch is
--    older than 2 months (a show reappears the moment they watch it again).
--    Each entry also carries watched/aired counts + last_watched_at so the UI
--    can draw a TV-Time-style progress bar.
--
-- 2. rpc_friend_progress(p_friend): watched/aired per followed title, for
--    progress bars on the friend's full show grid. security INVOKER — the 0015
--    friend-read RLS gates library_entries and watch_events, so a non-friend /
--    private profile yields no rows.

create or replace function public.rpc_friend_snapshot(p_friend uuid)
returns jsonb
language sql
security invoker
stable
as $$
  with prof as (
    select id, handle, display_name, avatar_url, bio, country
    from public.profiles where id = p_friend
  ),
  their_follows as (
    select t.id, t.tmdb_id, t.name, t.poster_path
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    where le.user_id = p_friend and le.followed
  ),
  my_follows as (
    select title_id from public.library_entries
    where user_id = (select auth.uid()) and followed
  ),
  their_ratings as (
    select t.tmdb_id, t.name, t.poster_path, r.score
    from public.ratings r
    join public.titles t on t.id = r.title_id
    where r.user_id = p_friend
    order by r.score desc, r.created_at desc
    limit 8
  ),
  watching as (
    select t.tmdb_id, t.name, t.poster_path, t.network,
           n.season_number, n.episode_number,
           lw.last_watched_at, lw.watched::int as watched,
           coalesce(t.aired_count, a.aired, 0)::int as aired
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    join lateral (
      select max(wv.watched_at) as last_watched_at, count(*) as watched
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id
      where wv.user_id = p_friend and e.title_id = t.id and e.season_number > 0
    ) lw on true
    left join lateral (
      select count(*) filter (where e.air_datetime <= now()) as aired
      from public.episodes e
      where e.title_id = t.id and e.season_number > 0
    ) a on true
    join lateral (
      select e.season_number, e.episode_number
      from public.episodes e
      where e.title_id = t.id and e.season_number > 0
        and e.air_datetime is not null and e.air_datetime <= now()
        and not exists (select 1 from public.watch_events wv where wv.user_id = p_friend and wv.episode_id = e.id)
      order by e.season_number, e.episode_number limit 1
    ) n on true
    where le.user_id = p_friend and le.followed
      and lw.last_watched_at is not null
      and lw.last_watched_at >= now() - interval '2 months'
    order by lw.last_watched_at desc
    limit 12
  )
  select case when not exists (select 1 from prof) then null else jsonb_build_object(
    'profile', (select to_jsonb(prof) from prof),
    'stats', jsonb_build_object(
      'shows', (select count(*) from their_follows),
      'episodes', (select count(*) from public.watch_events where user_id = p_friend),
      'rated', (select count(*) from public.ratings where user_id = p_friend)
    ),
    'shared', (select count(*) from their_follows tf where tf.id in (select title_id from my_follows)),
    'follows', (select coalesce(jsonb_agg(jsonb_build_object(
        'tmdb_id', tf.tmdb_id, 'name', tf.name, 'poster_path', tf.poster_path,
        'common', tf.id in (select title_id from my_follows)) order by tf.name), '[]'::jsonb) from their_follows tf),
    'ratings', (select coalesce(jsonb_agg(jsonb_build_object(
        'tmdb_id', tr.tmdb_id, 'name', tr.name, 'poster_path', tr.poster_path, 'score', tr.score)), '[]'::jsonb) from their_ratings tr),
    'watching', (select coalesce(jsonb_agg(jsonb_build_object(
        'tmdb_id', w.tmdb_id, 'name', w.name, 'poster_path', w.poster_path, 'network', w.network,
        'season_number', w.season_number, 'episode_number', w.episode_number,
        'watched', w.watched, 'aired', w.aired, 'last_watched_at', w.last_watched_at)
        order by w.last_watched_at desc), '[]'::jsonb) from watching w)
  ) end;
$$;

-- Per-followed-title progress for the friend page's show grid.
create function public.rpc_friend_progress(p_friend uuid)
returns table (tmdb_id int, watched int, aired int, last_watched_at timestamptz)
language sql
security invoker
stable
as $$
  select
    t.tmdb_id,
    coalesce(w.watched, 0)::int,
    coalesce(t.aired_count, a.aired, 0)::int,
    w.last_watched_at
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select count(*) as watched, max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e on e.id = wv.episode_id
    where wv.user_id = p_friend and e.title_id = t.id and e.season_number > 0
  ) w on true
  left join lateral (
    select count(*) filter (where e.air_datetime <= now()) as aired
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  where le.user_id = p_friend and le.followed
$$;

grant execute on function public.rpc_friend_progress(uuid) to authenticated;
