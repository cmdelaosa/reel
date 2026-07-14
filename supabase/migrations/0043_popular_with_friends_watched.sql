-- 0043_popular_with_friends_watched.sql
-- "Popular with friends" now surfaces only shows friends have actually watched
-- (>=1 regular-season episode), ranked by how many friends watched it and then
-- by the most recent watch. Was 0035: shows friends merely follow, ranked by
-- follower count / TMDB popularity. Output shape is unchanged, so the client
-- keeps parsing as-is. Stays security INVOKER so the 0015 friend-read RLS
-- still applies (same access path rpc_friend_activity already relies on).

create or replace function public.rpc_popular_with_friends()
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

grant execute on function public.rpc_popular_with_friends() to authenticated;
