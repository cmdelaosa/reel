-- 0048_watch_heatmap_user.sql
-- Extend rpc_watch_heatmap with an optional target user so the friend profile
-- can render the same activity grid as /you.
--
-- security invoker is what makes this safe: the 0015 "watch_events: friends
-- read" policy (accepted friend AND the owner is not private) filters the rows,
-- so pointing p_user at a stranger yields an empty grid rather than a leak.
--
-- Recreated rather than overloaded so there's a single signature to maintain.
-- p_user defaults to null → the caller's own history, so the existing two-arg
-- calls from the deployed client keep resolving here unchanged.

drop function if exists public.rpc_watch_heatmap(int, text);

create function public.rpc_watch_heatmap(days int default 182, tz text default 'UTC', p_user uuid default null)
returns table (day date, n bigint)
language sql
security invoker
stable
as $$
  select (w.watched_at at time zone tz)::date as day, count(*)::bigint as n
  from public.watch_events w
  where w.user_id = coalesce(p_user, (select auth.uid()))
    and w.watched_at >= now() - make_interval(days => days)
  group by 1
  order by 1
$$;

grant execute on function public.rpc_watch_heatmap(int, text, uuid) to authenticated;
