-- 0016_friend_snapshot.sql
-- rpc_friend_snapshot(p_friend): the friend profile sheet's data in one round
-- trip as jsonb. security INVOKER — the friend-read RLS from 0015 gates every
-- subquery, so a non-friend / private profile yields null (→ "not available").

create function public.rpc_friend_snapshot(p_friend uuid)
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
    select t.tmdb_id, t.name, t.poster_path, t.network, n.season_number, n.episode_number
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    join lateral (
      select e.season_number, e.episode_number
      from public.episodes e
      where e.title_id = t.id and e.season_number > 0
        and e.air_datetime is not null and e.air_datetime <= now()
        and not exists (select 1 from public.watch_events wv where wv.user_id = p_friend and wv.episode_id = e.id)
      order by e.season_number, e.episode_number limit 1
    ) n on true
    where le.user_id = p_friend and le.followed
      and exists (
        select 1 from public.watch_events wv2
        join public.episodes e2 on e2.id = wv2.episode_id
        where wv2.user_id = p_friend and e2.title_id = t.id
      )
    order by t.name
    limit 6
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
        'season_number', w.season_number, 'episode_number', w.episode_number)), '[]'::jsonb) from watching w)
  ) end;
$$;

grant execute on function public.rpc_friend_snapshot(uuid) to authenticated;
