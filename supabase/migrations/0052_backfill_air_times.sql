-- 0052_backfill_air_times.sql
-- One-shot: fire episode-refresh with ?force=1 so the TVmaze air times that
-- migration 0051 made room for land now, instead of trickling in as the daily
-- cron rotates through the library.
--
-- Why this is a migration when supabase/deploy/schedule-jobs.sql deliberately
-- is not: `supabase db push` authenticates through the CLI's access token and a
-- temporary login role, so it is the only route to the hosted database that
-- needs neither the postgres password (shown once at project creation, stored
-- nowhere) nor the service-role key (injected by the platform, and not any of
-- the keys `supabase projects api-keys` returns). The key stays in Vault and
-- Postgres reads it directly — nobody handles a secret to run this.
--
-- Guarded so it is inert wherever the hosted wiring is absent: a local
-- `supabase db reset` has neither pg_net nor the Vault secret, and this must
-- not fail the push there. Re-running is harmless — refreshTitle and
-- enrichAirTimes are both idempotent, and 0051's keepTvmazeTimes means a
-- refresh can no longer overwrite an air time it already resolved.
--
-- Scope of one invocation: the function stops at its own 330s wall guard,
-- roughly 220 of the ~600 followed titles, oldest-refreshed first. The nightly
-- cron takes the remainder. This file has no dependents and can be deleted
-- once it has run.

do $$
declare
  key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net not installed — skipping air-time backfill';
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault unavailable — skipping air-time backfill';
    return;
  end if;

  select decrypted_secret into key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if key is null then
    raise notice 'service_role_key absent from vault — skipping air-time backfill';
    return;
  end if;

  perform net.http_post(
    url     := 'https://kjdnjuicghemusfiiign.supabase.co/functions/v1/episode-refresh?force=1',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || key,
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );

  raise notice 'air-time backfill queued';
end
$$;
