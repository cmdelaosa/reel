-- 0061_friend_request_email.sql
-- Give `friend_request` a real email channel, so the Email chip Settings is
-- about to show for it is a switch and not a decoration.
--
-- Until now exactly one notification type could reach you by mail: new_episode,
-- through the daily `alerts` digest. That is why 0059 hid the Email chip on the
-- other three — a toggle with no producer behind it is worse than no toggle.
-- Friend requests are produced by the trigger below, and a trigger cannot call
-- Resend, so the channel had to be built rather than re-enabled.
--
-- WHY pg_net AND NOT THE DAILY RUN. A friend request is only news for as long
-- as you haven't opened the app. Folding it into the nightly job would deliver
-- the mail up to 24h after the in-app notification the person has already seen,
-- which is precisely when an email stops being worth sending. So the trigger
-- fires the send itself, asynchronously, and it lands in seconds.
--
-- The call is fire-and-forget by construction: net.http_post queues the request
-- and returns immediately, so a slow or dead mailer cannot hold open the
-- transaction that is inserting the friendship row. Nothing about accepting a
-- friend request depends on the email leaving.
--
-- OBSERVABILITY. pg_net discards the response (see 0029), so the function logs
-- its own outcome to job_runs — including the skips (preference off, no sender
-- configured, no address on file). `select * from job_runs where job =
-- 'friend-request-email'` is the place to look, not the edge logs.

-- ── the mailer hand-off ──────────────────────────────────────────────────────
-- Split out of the trigger so the trigger stays about the decision and this
-- stays about the plumbing. Inert wherever the hosted wiring is absent: a local
-- `supabase db reset` has neither pg_net nor the Vault secret, and a missing
-- mailer must never fail the friend request that triggered it. Same guards as
-- 0052, which is the other place we call out to a function from SQL.
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

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'service_role_key';
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

-- Nobody but the trigger. It is SECURITY DEFINER and it reads the service-role
-- key out of Vault, so an authenticated caller must not be able to reach it.
revoke all on function public.queue_friend_request_email(uuid, text, text) from public;
revoke all on function public.queue_friend_request_email(uuid, text, text) from anon, authenticated;

-- ── the trigger ──────────────────────────────────────────────────────────────
-- Restructured from 0059: that version read only `inapp` and returned early
-- when it was off, which would now swallow the email too. The two channels are
-- independent — Email on with App off is a legitimate setting, and someone who
-- has muted the inbox but wants the mail must still get it. Absent row = the
-- defaults the client renders: in-app on, email off.
create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := case when new.a = new.requested_by then new.b else new.a end;
  v_handle text;
  v_name text;
  v_inapp boolean;
  v_email boolean;
begin
  if new.status <> 'pending' then return new; end if;

  select inapp, email into v_inapp, v_email
    from public.notification_prefs
   where user_id = v_target and type = 'friend_request';
  v_inapp := coalesce(v_inapp, true);
  v_email := coalesce(v_email, false);

  if not v_inapp and not v_email then return new; end if;

  select handle::text, display_name into v_handle, v_name
    from public.profiles where id = new.requested_by;

  if v_inapp then
    insert into public.notifications (user_id, type, payload)
    values (v_target, 'friend_request',
            jsonb_build_object('from_id', new.requested_by, 'from_handle', v_handle, 'from_name', v_name));
  end if;

  if v_email then
    perform public.queue_friend_request_email(v_target, v_handle, v_name);
  end if;

  return new;
end;
$$;
