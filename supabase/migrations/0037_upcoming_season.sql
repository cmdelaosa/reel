-- 0037_upcoming_season.sql
-- "Returning series" (Calendar) needs to know when a show the user already
-- started is coming back — INCLUDING when the next season is announced but not
-- yet dated. next_air_datetime only covers seasons whose episodes TMDB has
-- dated; an announced-but-undated next season leaves it null.
--
-- Like aired_count (0028), this is derived AUTHORITATIVELY from TMDB's title
-- payload by tmdb-proxy / episode-refresh (see app/src/domain/airedCount.ts →
-- computeUpcomingSeason) and cached on `titles`, rather than inferred from the
-- lazily-filled `episodes`/`seasons` cache. Existing rows read null until their
-- next refresh (< 20h via the cron), then self-heal.

alter table public.titles add column upcoming_season_number int;
alter table public.titles add column upcoming_season_air_date date;

-- Recreate rpc_library_rollup (last defined in 0028) to surface the two new
-- columns. Everything else is unchanged.
drop function if exists public.rpc_library_rollup();
create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  name text,
  poster_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  stopped boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  last_aired_datetime timestamptz,
  next_air_datetime timestamptz,
  upcoming_season_number int,
  upcoming_season_air_date date
)
language sql
security invoker
stable
as $$
  select
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.stopped,
    le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.last_aired,
    a.next_air,
    t.upcoming_season_number,
    t.upcoming_season_air_date
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  left join lateral (
    select count(*) as watched, max(we.watched_at) as last_watched_at
    from public.watch_events we
    join public.episodes e2 on e2.id = we.episode_id
    where we.user_id = (select auth.uid())
      and e2.title_id = t.id
      and e2.season_number > 0
  ) w on true
  where le.user_id = (select auth.uid())
    and le.followed
$$;
grant execute on function public.rpc_library_rollup() to authenticated;
