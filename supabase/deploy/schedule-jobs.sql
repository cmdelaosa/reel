-- schedule-jobs.sql — one-shot provisioning of the daily cron jobs on HOSTED
-- Supabase. NOT a migration (it needs the hosted project + the service-role key,
-- neither of which exists at `supabase db push` time). Run it once, by hand,
-- after deploying the edge functions. See docs/DEPLOY.md.
--
-- Before running: replace <PROJECT_REF> below with your project ref (the
-- subdomain of your project's API URL, e.g. abcdefgh in
-- https://abcdefgh.supabase.co), and set the service_role_key secret in the
-- Vault step. Run it in the hosted SQL editor (or `supabase db execute`).

-- 1. Extensions: cron scheduler + HTTP client for pg_cron → edge function calls.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the service-role key in Vault so the cron body can send it as the
--    bearer token every one of these functions requires (they 401 otherwise —
--    tmdb-proxy/warm rejects anything that is not this exact key). Get it from
--    Dashboard → Project Settings → API → service_role key. Idempotent-ish:
--    if you re-run, delete the old secret first
--    (`select vault.delete_secret('service_role_key');`) to avoid duplicates.
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- 3a. episode-refresh — daily 05:00 UTC. Refreshes titles + latest seasons.
select cron.schedule(
  'episode-refresh-daily',
  '0 5 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 3b. discover-warm — daily 04:40 UTC. Rebuilds the four Explore discovery
--     caches (trending, popular-now, popular, top-rated) before anyone opens
--     the app, so no reader is the one who pays to refill them. Without it the
--     first visitor after the 24h TTL lapsed wore a cold popular-now rebuild:
--     ~80 sequential TMDB detail fetches, seconds of blank grid.
--     Scheduled 20 min ahead of episode-refresh so the two heaviest TMDB
--     consumers don't share a rate-limit window.
--     Check it like any other job:
--       select ok, summary, started_at from public.job_runs
--        where job = 'discover-warm' order by started_at desc limit 5;
select cron.schedule(
  'discover-warm-daily',
  '40 4 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/tmdb-proxy/warm',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- 3c. alerts — daily 05:30 UTC (after episode-refresh so it sees fresh episodes).
select cron.schedule(
  'alerts-daily',
  '30 5 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 3d. One-time backfill: fire episode-refresh NOW with ?force=1 so every
--     followed title gets its derivations (aired_count, upcoming_season_number)
--     recomputed immediately, bypassing the staleness gate — instead of waiting
--     up to ~a day for the daily cron to reach it. Safe to omit or re-run.
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh?force=1',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb
);

-- 3e. Fill the discovery caches NOW rather than waiting for tomorrow's 04:40 —
--     right after a deploy they are empty, which is exactly the cold-start this
--     job exists to prevent. Safe to re-run.
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/tmdb-proxy/warm',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 120000
);

-- 4. Verify. All three jobs should be listed; after the first fire,
--    job_run_details shows status='succeeded'.
--   select jobname, schedule, active from cron.job;
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--
-- To change a schedule, re-run cron.schedule with the SAME jobname (it upserts).
-- To remove: select cron.unschedule('episode-refresh-daily');
