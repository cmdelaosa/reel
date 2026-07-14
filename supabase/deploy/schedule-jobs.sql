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
--    bearer token both functions require (they 401 otherwise). Get it from
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

-- 3b. alerts — daily 05:30 UTC (after episode-refresh so it sees fresh episodes).
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

-- 3c. One-time backfill: fire episode-refresh NOW with ?force=1 so every
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

-- 4. Verify. Both jobs should be listed; after the first fire, job_run_details
--    shows status='succeeded'.
--   select jobname, schedule, active from cron.job;
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--
-- To change a schedule, re-run cron.schedule with the SAME jobname (it upserts).
-- To remove: select cron.unschedule('episode-refresh-daily');
