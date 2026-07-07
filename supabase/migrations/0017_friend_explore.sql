-- 0017_friend_explore.sql
-- Friend-powered Explore aggregates. Both security INVOKER so the 0015
-- friend-read RLS applies (private / non-accepted friends contribute nothing).

-- Titles followed by ≥2 of my accepted friends, with the friend list.
create function public.rpc_popular_with_friends()
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
  ff as (
    select le.title_id, p.id as fid, p.display_name, p.avatar_url
    from my_friends mf
    join public.library_entries le on le.user_id = mf.fid and le.followed
    join public.profiles p on p.id = mf.fid
  ),
  agg as (
    select title_id, count(*) as cnt,
           jsonb_agg(jsonb_build_object('id', fid, 'name', display_name, 'avatar_url', avatar_url)) as friends
    from ff group by title_id having count(*) >= 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'tmdb_id', t.tmdb_id, 'name', t.name, 'poster_path', t.poster_path, 'network', t.network,
    'first_air_date', t.first_air_date, 'genres', t.genres, 'vote_average', t.vote_average,
    'count', a.cnt, 'friends', a.friends,
    'i_follow', exists (select 1 from public.library_entries le2
                        where le2.user_id = (select auth.uid()) and le2.title_id = t.id and le2.followed)
  ) order by a.cnt desc, t.popularity desc nulls last), '[]'::jsonb)
  from agg a join public.titles t on t.id = a.title_id;
$$;

grant execute on function public.rpc_popular_with_friends() to authenticated;

-- Titles rated by ≥2 of my accepted friends, with the average and the raters.
create function public.rpc_best_rated_by_friends()
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
    join public.profiles p on p.id = mf.fid
  ),
  agg as (
    select title_id, round(avg(score)::numeric, 1) as avg_score, count(*) as cnt,
           jsonb_agg(jsonb_build_object('id', fid, 'name', display_name, 'avatar_url', avatar_url, 'score', score)) as raters
    from fr group by title_id having count(*) >= 2
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

grant execute on function public.rpc_best_rated_by_friends() to authenticated;
