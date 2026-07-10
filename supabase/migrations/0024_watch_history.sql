-- 0024_watch_history.sql
-- rpc_watch_history: the caller's watched episodes, newest first, joined to
-- episode + show display columns. Keyset pagination on (watched_at, id) so a
-- binge marked/imported within the same second never loses or duplicates rows
-- across pages. security INVOKER — watch_events RLS scopes to the caller.

create function public.rpc_watch_history(
  p_limit int default 60,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  watch_event_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  poster_path text,
  network text,
  season_number int,
  episode_number int,
  episode_name text,
  watched_at timestamptz,
  source text
)
language sql
security invoker
stable
as $$
  select
    wv.id,
    e.id,
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.network,
    e.season_number,
    e.episode_number,
    e.name,
    wv.watched_at,
    wv.source
  from public.watch_events wv
  join public.episodes e on e.id = wv.episode_id
  join public.titles t on t.id = e.title_id
  where wv.user_id = (select auth.uid())
    and (
      p_before is null
      or wv.watched_at < p_before
      or (wv.watched_at = p_before and wv.id < p_before_id)
    )
  order by wv.watched_at desc, wv.id desc
  limit greatest(1, least(p_limit, 200))
$$;

grant execute on function public.rpc_watch_history(int, timestamptz, uuid) to authenticated;
