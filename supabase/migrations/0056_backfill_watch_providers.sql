-- 0056_backfill_watch_providers.sql
-- One-shot backfill for the providers column 0055 added.
--
-- Without it, `titles.providers` is null for every show already cached and the
-- app renders no logo anywhere until each title's next nightly refresh — which
-- would read exactly like the feature is broken, for days.
--
-- Same mechanism as the 0053 air-time backfill, and for the same reason: take
-- the authentication from the place that is demonstrably working rather than
-- guessing a Vault key name. The 'episode-refresh-daily' cron job fires
-- successfully every morning, so its stored command already carries whatever
-- header the function accepts. Copy that command, point its URL at ?force=1,
-- and execute it. Nothing here reads, prints or logs the credential — only
-- whether the URL rewrite matched.
--
-- Inert without pg_cron or the job (a local `supabase db reset` has neither),
-- and safe to re-run: refreshTitle converges. One invocation covers the titles
-- it can reach before the function's 330s wall guard stops it, oldest-refreshed
-- first; the nightly cron takes the rest. Unfollowed titles aren't in that
-- sweep at all — they pick providers up from tmdb-proxy the first time anyone
-- opens them. No dependents — deletable once it has run.

do $$
declare
  cmd    text;
  forced text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not installed — skipping watch-provider backfill';
    return;
  end if;

  select command into cmd
  from cron.job
  where jobname = 'episode-refresh-daily';

  if cmd is null then
    raise notice 'episode-refresh-daily job not found — skipping watch-provider backfill';
    return;
  end if;

  forced := replace(cmd, '/episode-refresh''', '/episode-refresh?force=1''');

  if forced = cmd then
    raise notice 'could not add force=1 to the job URL — firing it unmodified';
  else
    raise notice 'force=1 applied to the job URL';
  end if;

  execute forced;
  raise notice 'watch-provider backfill queued via the cron job definition';
end
$$;
