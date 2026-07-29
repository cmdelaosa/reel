-- 0054_backfill_calendar_air_times.sql
-- Targeted finish to the air-time backfill 0053 started.
--
-- 0053 fired episode-refresh with ?force=1, which walks the library
-- oldest-refreshed first. That is the wrong end: air times are only ever
-- rendered on the calendar (CalEpRow / CalEpGroup — the detail sheet and
-- history show dates), and the calendar's shows are the *freshest* rows, so
-- they sort last. The run spent its budget on Ended shows whose clocks nobody
-- sees and stopped, killed by the platform's background-execution limit after
-- 133 titles, leaving every episode in the calendar window still 'estimated'.
--
-- So instead of another blind pass: null last_refreshed_at for exactly the
-- titles with an episode in the calendar window. episode-refresh treats null as
-- infinitely stale and orders nulls first, so an ordinary (unforced) run picks
-- them up ahead of everything else and finishes well inside the limit.
--
-- Nulling the marker briefly makes tmdb-proxy treat those titles as
-- never-cached, so the first request for one blocks on TMDB instead of serving
-- cache. The refresh below repopulates it seconds later; the window is small
-- and self-correcting.
--
-- Guarded and idempotent on the same terms as 0052/0053. Last of the one-shot
-- backfill migrations — from here the nightly cron maintains it.

do $$
declare
  cmd text;
  n   int;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not installed — skipping calendar air-time backfill';
    return;
  end if;

  select command into cmd
  from cron.job
  where jobname = 'episode-refresh-daily';

  if cmd is null then
    raise notice 'episode-refresh-daily job not found — skipping calendar air-time backfill';
    return;
  end if;

  update public.titles t
  set last_refreshed_at = null
  where t.id in (
    select distinct e.title_id
    from public.episodes e
    join public.library_entries le
      on le.title_id = e.title_id and le.followed
    where e.season_number > 0
      and e.air_datetime >= now() - interval '7 days'
      and e.air_datetime <= now() + interval '30 days'
  );
  get diagnostics n = row_count;
  raise notice 'calendar titles queued for refresh: %', n;

  if n = 0 then
    raise notice 'nothing in the calendar window — not firing';
    return;
  end if;

  -- Unmodified: the nulls above are what makes these titles stale, so the
  -- job's own staleness gate now selects exactly them, newest work first.
  execute cmd;
  raise notice 'calendar air-time refresh queued';
end
$$;
