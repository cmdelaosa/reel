-- 0010_user_stats.sql
-- rpc_user_stats: profile stat card numbers, computed server-side.
-- Time spent = sum of episode runtime, falling back to the title's
-- episode_run_time, falling back to 40 minutes. security INVOKER.

create function public.rpc_user_stats()
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
      where w.user_id = (select auth.uid())),
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid())),
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed),
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed
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
