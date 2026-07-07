-- 0018_friend_activity.sql
-- rpc_friend_activity(p_limit): a merged, time-ordered feed of accepted
-- friends' recent actions — rated, added, started (first watch of a title),
-- finished_season (watched every episode of a season). security INVOKER, so the
-- 0015 friend-read RLS gates every source. One query.

create function public.rpc_friend_activity(p_limit int default 30)
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
  rated as (
    select r.user_id as fid, 'rated' as verb, t.tmdb_id, t.name, t.poster_path,
           r.score::int as score, null::int as season_number, r.created_at as at
    from my_friends mf
    join public.ratings r on r.user_id = mf.fid and r.title_id is not null
    join public.titles t on t.id = r.title_id
  ),
  added as (
    select le.user_id, 'added', t.tmdb_id, t.name, t.poster_path,
           null::int, null::int, le.added_at
    from my_friends mf
    join public.library_entries le on le.user_id = mf.fid and le.followed
    join public.titles t on t.id = le.title_id
  ),
  first_watch as (
    select wv.user_id, e.title_id, min(wv.watched_at) as at
    from my_friends mf
    join public.watch_events wv on wv.user_id = mf.fid
    join public.episodes e on e.id = wv.episode_id and e.season_number > 0
    group by wv.user_id, e.title_id
  ),
  started as (
    select fw.user_id, 'started', t.tmdb_id, t.name, t.poster_path,
           null::int, null::int, fw.at
    from first_watch fw
    join public.titles t on t.id = fw.title_id
  ),
  season_total as (
    select title_id, season_number, count(*) as total
    from public.episodes where season_number > 0 group by title_id, season_number
  ),
  friend_season as (
    select wv.user_id, e.title_id, e.season_number, count(*) as watched, max(wv.watched_at) as at
    from my_friends mf
    join public.watch_events wv on wv.user_id = mf.fid
    join public.episodes e on e.id = wv.episode_id and e.season_number > 0
    group by wv.user_id, e.title_id, e.season_number
  ),
  finished as (
    select fs.user_id, 'finished_season', t.tmdb_id, t.name, t.poster_path,
           null::int, fs.season_number, fs.at
    from friend_season fs
    join season_total st on st.title_id = fs.title_id and st.season_number = fs.season_number and fs.watched >= st.total
    join public.titles t on t.id = fs.title_id
  ),
  unioned as (
    select * from rated
    union all select * from added
    union all select * from started
    union all select * from finished
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  from (
    select p.id as friend_id, p.display_name as friend_name, p.avatar_url as friend_avatar,
           u.verb, u.tmdb_id, u.name as title_name, u.poster_path, u.score, u.season_number, u.at
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;

grant execute on function public.rpc_friend_activity(int) to authenticated;
