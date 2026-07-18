-- 0047_watch_heatmap.sql
-- rpc_watch_heatmap: per-day watch counts for the profile heatmap, bucketed in
-- the caller's timezone so a late-night episode lands on the right local day.
-- Aggregated server-side (≤ `days` rows) so heavy histories never hit the
-- PostgREST max-rows cap. security INVOKER — the owner RLS policy scopes rows.

create function public.rpc_watch_heatmap(days int default 182, tz text default 'UTC')
returns table (day date, n bigint)
language sql
security invoker
stable
as $$
  select (w.watched_at at time zone tz)::date as day, count(*)::bigint as n
  from public.watch_events w
  where w.user_id = (select auth.uid())
    and w.watched_at >= now() - make_interval(days => days)
  group by 1
  order by 1
$$;

grant execute on function public.rpc_watch_heatmap(int, text) to authenticated;
