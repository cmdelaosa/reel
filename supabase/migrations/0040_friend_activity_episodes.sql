-- 0040_friend_activity_episodes.sql
-- Friend activity feed v2: the digest verbs (started / finished_season) give
-- way to the raw material — one 'watched' event per episode, alongside 'added'
-- and 'rated'. Same signature and envelope as 0018; 'watched' rows carry
-- season_number + episode_number. security INVOKER, so the 0015 friend-read
-- RLS still gates every source.

create or replace function public.rpc_friend_activity(p_limit int default 30)
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
           r.score::int as score, null::int as season_number, null::int as episode_number,
           r.created_at as at
    from my_friends mf
    join public.ratings r on r.user_id = mf.fid and r.title_id is not null
    join public.titles t on t.id = r.title_id
  ),
  added as (
    select le.user_id, 'added', t.tmdb_id, t.name, t.poster_path,
           null::int, null::int, null::int, le.added_at
    from my_friends mf
    join public.library_entries le on le.user_id = mf.fid and le.followed
    join public.titles t on t.id = le.title_id
  ),
  watched as (
    select wv.user_id, 'watched', t.tmdb_id, t.name, t.poster_path,
           null::int, e.season_number, e.episode_number, wv.watched_at
    from my_friends mf
    join public.watch_events wv on wv.user_id = mf.fid
    join public.episodes e on e.id = wv.episode_id and e.season_number > 0
    join public.titles t on t.id = e.title_id
  ),
  unioned as (
    select * from rated
    union all select * from added
    union all select * from watched
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  from (
    select p.id as friend_id, p.display_name as friend_name, p.avatar_url as friend_avatar,
           u.verb, u.tmdb_id, u.name as title_name, u.poster_path, u.score,
           u.season_number, u.episode_number, u.at
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;

grant execute on function public.rpc_friend_activity(int) to authenticated;
