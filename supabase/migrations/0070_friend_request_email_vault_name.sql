-- 0070_friend_request_email_vault_name.sql
-- Make the friend-request mailer read the Vault secret this project actually
-- holds. Nothing about the trigger's behaviour changes; the only edit is the
-- name in the lookup, from `service_role_key` to `episode_refresh_service_key`.
--
-- WHAT WAS BROKEN. 0061 looked the service-role key up as `service_role_key`,
-- which is the obvious name and the wrong one. The hosted project stores it as
-- `episode_refresh_service_key` — named after the first cron that needed it and
-- since inherited by every other caller (see the long comment at step 2 of
-- `supabase/deploy/schedule-jobs.sql`, which is the only thing that ever
-- creates it). No project has held a secret called `service_role_key`, so the
-- select returned NULL and `queue_friend_request_email` took its `if v_key is
-- null then return` exit every single time.
--
-- WHY NOBODY NOTICED. That guard exists so a local `supabase db reset`, which
-- has no Vault at all, cannot fail the friend request that triggered the mail —
-- and it cannot tell "no Vault here" from "no secret by that name" apart. The
-- send was skipped before pg_net was ever called, so there is no failed request
-- in net._http_response, no row in job_runs, and no line in the edge logs. The
-- in-app notification is inserted by the same trigger and kept working, which
-- made the silence read as a mailer problem rather than a missing secret.
--
-- WHY THIS DIRECTION. Unifying the other way — renaming the secret in Vault to
-- `service_role_key` — means an out-of-band step against the live project that
-- breaks all five cron call sites for the window between the rename and their
-- redeploy. Moving the reader is a migration, applies with `db push`, and needs
-- no coordination. One name survives, and it is the one already in production.
--
-- THIS IS THE SECOND TIME. 0052's one-shot backfill guessed the same wrong name
-- and skipped for the same reason, and `0053_backfill_air_times_via_cron_job.sql`
-- exists only to work around it — its header says so in as many words, and its
-- fix was to copy the Authorization header out of a cron job that was already
-- working rather than name the secret at all. So the failure mode has a track
-- record: whenever something new calls an edge function from SQL, the obvious
-- name is the one that gets typed, and the guard hides the mistake.
--
-- 0052 itself keeps the stale name. It is a `do $$` block that ran once, found
-- nothing, and was superseded by 0053; leaving it is honest history and
-- rewriting it would change nothing that runs again.
create or replace function public.queue_friend_request_email(
  p_user uuid,
  p_handle text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return;
  end if;
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  -- The name is load-bearing and it is not the obvious one; see above and
  -- `supabase/deploy/schedule-jobs.sql`. If it is ever renamed, it moves here
  -- and in that file's five call sites in the same change.
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'episode_refresh_service_key';
  if v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := 'https://kjdnjuicghemusfiiign.supabase.co/functions/v1/friend-request-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body    := jsonb_build_object(
      'user_id', p_user,
      'from_handle', p_handle,
      'from_name', p_name
    )
  );
end;
$$;

-- `create or replace` keeps the ACL, but 0061's revokes are cheap to restate
-- and this way the grants do not depend on that migration having run first.
revoke all on function public.queue_friend_request_email(uuid, text, text) from public;
revoke all on function public.queue_friend_request_email(uuid, text, text) from anon, authenticated;
