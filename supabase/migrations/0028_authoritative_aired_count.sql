-- 0028_authoritative_aired_count.sql
-- Fix show status/progress being derived from an incomplete episode cache.
--
-- rpc_library_rollup counted aired episodes from the `episodes` table, but that
-- table is only lazily filled: following a show caches seasons (not episodes),
-- opening a season caches that season, and the cron backfills just the latest 2
-- seasons. So aired_count was systematically low for un-drilled shows (wrong
-- progress %, and a just-followed airing show read as "upcoming" with 0 aired),
-- and it shifted when OTHER users browsed the shared cache.
--
-- Fix: titles now carry an authoritative `aired_count`, computed by tmdb-proxy /
-- episode-refresh from TMDB's title payload (last_episode_to_air + per-season
-- episode_count — see app/src/domain/airedCount.ts). The rollup reads it and
-- falls back to the old cached-episode count when it's null (titles not yet
-- refreshed since this migration), so nothing regresses and rows self-heal.

alter table public.titles add column aired_count int;

-- Recreate rpc_library_rollup with aired_count = coalesce(authoritative, old).
-- Only the aired_count output changes; last_aired/next_air still come from the
-- lateral (the latest seasons the cron keeps fresh cover the boundary episodes).
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
  next_air_datetime timestamptz
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
    a.next_air
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
