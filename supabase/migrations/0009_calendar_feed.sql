-- 0009_calendar_feed.sql
-- rpc_calendar_feed: episodes of the caller's followed shows with air dates in
-- [p_from, p_to], with premiere/finale flags computed in SQL and the caller's
-- watch_event id when seen. security INVOKER.

create function public.rpc_calendar_feed(p_from timestamptz, p_to timestamptz)
returns table (
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  poster_path text,
  network text,
  season_number int,
  episode_number int,
  episode_name text,
  air_datetime timestamptz,
  is_premiere boolean,
  is_finale boolean,
  watch_event_id uuid
)
language sql
security invoker
stable
as $$
  select
    e.id,
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.network,
    e.season_number,
    e.episode_number,
    e.name,
    e.air_datetime,
    e.episode_number = 1 as is_premiere,
    e.episode_number = season_last.max_ep as is_finale,
    wv.id
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join public.episodes e
    on e.title_id = t.id
   and e.season_number > 0
   and e.air_datetime is not null
   and e.air_datetime >= p_from
   and e.air_datetime <= p_to
  join lateral (
    select max(e3.episode_number) as max_ep
    from public.episodes e3
    where e3.title_id = e.title_id and e3.season_number = e.season_number
  ) season_last on true
  left join public.watch_events wv
    on wv.episode_id = e.id and wv.user_id = (select auth.uid())
  where le.user_id = (select auth.uid())
    and le.followed
  order by e.air_datetime, t.name, e.episode_number
$$;

grant execute on function public.rpc_calendar_feed(timestamptz, timestamptz) to authenticated;
