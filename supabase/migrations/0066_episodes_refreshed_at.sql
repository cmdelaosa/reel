-- 0066_episodes_refreshed_at.sql
-- Split "this title's detail is fresh" from "this title's episodes are fresh".
--
-- They were the same column, `last_refreshed_at`, and two jobs wrote it with
-- two different meanings:
--
--   * episode-refresh (05:00 UTC) stamps it after refreshing the title row AND
--     the latest two seasons' episodes, air times included. Its staleness gate
--     (20h) then reads it back to decide who to touch tomorrow.
--   * discover-warm (04:40 UTC) resolves the popular-now pool, which fetches
--     full TMDB details and so writes rich rows via titleRow() — including
--     `last_refreshed_at`. Episodes are never involved: popular-now writes
--     titles, not seasons.
--
-- Twenty minutes apart, the second one made the first one's gate lie. Any
-- followed title sitting in popular-now looked refreshed-at-04:40 by 05:00 and
-- was skipped — every day, for as long as it stayed in the pool. Its episodes,
-- air times and per-episode scores simply stopped being maintained, and the
-- alerts job (which reads episodes) had nothing new to notify about. Observed
-- on 12-ago-2026 with Silo and Ted Lasso; 15 followed titles were in the pool.
--
-- So: `last_refreshed_at` keeps its honest meaning (the title row's detail was
-- refetched from TMDB — discover-warm really does that, and /title is right to
-- treat those rows as fresh), and the new `episodes_refreshed_at` carries the
-- one that matters to episode-refresh and to /title/:id/season/:n.
--
-- Backfill: copy `last_refreshed_at`, which for every title the cron has
-- touched is exactly right (it wrote both at once). Starting from NULL instead
-- would mark all ~600 followed titles infinitely stale, and the next run would
-- burn its wall guard and a day of TMDB budget re-fetching settled shows.
--
-- Then null it back out for the titles in popular_now_cache — the set the bug
-- actually starved, whose copied value is the discovery stamp and therefore the
-- lie we are removing. episode-refresh orders nulls first, so the next ordinary
-- run picks up exactly those, ahead of everything else. Same trick as 0054.
--
-- Idempotent: the add is `if not exists`, and re-running only re-queues the
-- pool's titles, which is harmless (refreshTitle is idempotent).

alter table public.titles
  add column if not exists episodes_refreshed_at timestamptz;

comment on column public.titles.episodes_refreshed_at is
  'When this title''s episode set was last refreshed from TMDB (episode-refresh''s '
  'latest-two-seasons pass, or tmdb-proxy''s whole-show fill). Distinct from '
  'last_refreshed_at, which only means the title row''s detail was refetched — '
  'the discovery warm-up writes that one without touching a single episode.';

do $$
declare
  n int;
begin
  update public.titles
  set episodes_refreshed_at = last_refreshed_at
  where episodes_refreshed_at is null
    and last_refreshed_at is not null;
  get diagnostics n = row_count;
  raise notice 'episodes_refreshed_at seeded from last_refreshed_at: %', n;

  -- popular_now_cache is empty on a fresh local database; then this is a no-op.
  update public.titles t
  set episodes_refreshed_at = null
  where exists (
    select 1 from public.popular_now_cache pn where pn.tmdb_id = t.tmdb_id
  );
  get diagnostics n = row_count;
  raise notice 'titles in the discovery pool queued for an episode refresh: %', n;
end
$$;
