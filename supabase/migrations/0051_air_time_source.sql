-- 0051_air_time_source.sql
-- Real broadcast times.
--
-- Until now every episode's air_datetime was TMDB's air_date (a bare day, no
-- time, no zone) with a hard-coded 21:00 UTC stapled on. The client renders it
-- in the viewer's timezone, so a placeholder became a confident-looking lie:
-- Game of Thrones 1x01 really aired 2011-04-18T01:00Z, we stored
-- 2011-04-17T21:00Z — four hours and one calendar day out in Spain.
--
-- TVmaze publishes a real `airstamp` (absolute, DST already resolved) for most
-- series, so the ingest now overwrites air_datetime with it. air_time_source
-- records which of the two we hold, so the UI can show the clock only when it
-- means something and fall back to the date alone otherwise.
--
-- Episodes TVmaze doesn't cover keep the 21:00 UTC placeholder: the aired-count
-- / mark-up-to / up-next gates all key off `air_datetime <= now()`, and moving
-- the placeholder would silently shift what counts as aired. It stays correct
-- to the day everywhere from UTC-3 to UTC+2 and drifts a day in Asia-Pacific —
-- accepted, since we no longer print an hour for those rows.

-- TVmaze has no TMDB id: we resolve its show id through the IMDb id that TMDB
-- hands us in external_ids, then cache both so the lookup happens once.
alter table public.titles add column if not exists imdb_id text;
alter table public.titles add column if not exists tvmaze_id int;

alter table public.episodes
  add column if not exists air_time_source text not null default 'estimated';

do $$
begin
  alter table public.episodes
    add constraint episodes_air_time_source_check
    check (air_time_source in ('tvmaze', 'estimated'));
exception
  when duplicate_object then null;
end
$$;

-- The enrichment pass looks up "titles that still need a TVmaze id".
create index if not exists titles_tvmaze_pending_idx
  on public.titles (id)
  where tvmaze_id is null;

-- ── rpc_calendar_feed — carry air_time_source to the client ─────────────────
-- Same body as 0022; the new column rides along so CalEpRow/CalEpGroup can
-- decide between "21:00" and a bare date. Dropped first, not "or replace":
-- adding an OUT column changes the return type, which replace cannot do.
drop function if exists public.rpc_calendar_feed(timestamptz, timestamptz);
create function public.rpc_calendar_feed(p_from timestamptz, p_to timestamptz)
returns table (
  episode_id uuid, title_id uuid, tmdb_id int, show_name text, poster_path text,
  network text, season_number int, episode_number int, episode_name text,
  air_datetime timestamptz, air_time_source text, is_premiere boolean,
  is_finale boolean, watch_event_id uuid
)
language sql
security invoker
stable
as $$
  select
    e.id, t.id, t.tmdb_id, t.name, t.poster_path, t.network,
    e.season_number, e.episode_number, e.name, e.air_datetime, e.air_time_source,
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
    and not le.stopped
  order by e.air_datetime, t.name, e.episode_number
$$;
grant execute on function public.rpc_calendar_feed(timestamptz, timestamptz) to authenticated;
