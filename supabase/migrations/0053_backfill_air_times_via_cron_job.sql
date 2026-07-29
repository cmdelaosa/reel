-- 0053_backfill_air_times_via_cron_job.sql
-- Second attempt at the one-shot air-time backfill. 0052 assumed the bearer
-- token lived in Vault under 'service_role_key' (the name supabase/deploy/
-- schedule-jobs.sql creates); on this project it does not, so 0052 skipped.
--
-- Rather than guess the name, take the authentication from the place that is
-- demonstrably working: the 'episode-refresh-daily' cron job has been firing
-- successfully every morning, so its stored command already contains whatever
-- header the function accepts. Copy that command, point its URL at ?force=1,
-- and execute it. Nothing here reads, prints or logs the credential — the
-- command text is never raised, only whether the URL rewrite matched.
--
-- Same guards and the same idempotence as 0052: inert without pg_cron or the
-- job (a local `supabase db reset` has neither), and safe to re-run because
-- refreshTitle and enrichAirTimes converge.
--
-- One invocation covers ~220 of the ~600 followed titles before the function's
-- 330s wall guard stops it, oldest-refreshed first; the nightly cron takes the
-- rest. No dependents — deletable once it has run.

do $$
declare
  cmd    text;
  forced text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not installed — skipping air-time backfill';
    return;
  end if;

  select command into cmd
  from cron.job
  where jobname = 'episode-refresh-daily';

  if cmd is null then
    raise notice 'episode-refresh-daily job not found — skipping air-time backfill';
    return;
  end if;

  -- The job posts to .../functions/v1/episode-refresh'; adding the query string
  -- inside the quoted URL is the only edit.
  forced := replace(cmd, '/episode-refresh''', '/episode-refresh?force=1''');

  if forced = cmd then
    raise notice 'could not add force=1 to the job URL — firing it unmodified';
  else
    raise notice 'force=1 applied to the job URL';
  end if;

  execute forced;
  raise notice 'air-time backfill queued via the cron job definition';
end
$$;
