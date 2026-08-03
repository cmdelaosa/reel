-- 0063_friend_request_email_default.sql
-- Friend requests email you unless you say otherwise, and the Imports toggle is
-- retired.
--
-- ── the default ──────────────────────────────────────────────────────────────
-- notification_prefs rows are written lazily, on the first toggle, so for almost
-- everyone there is no row at all and the coalesce below IS the setting. 0061
-- shipped friend_request email defaulting to off, which made the channel
-- something you had to go and find; a friend request is rare, personal, and
-- worthless to learn about days later, which is the one shape of notification
-- mail is actually good at.
--
-- Note what this does NOT change: new_episode still defaults to email off. That
-- digest covers a whole library and opting in stays the user's call — the
-- default is per type, not global.
--
-- The same value is hard-coded in two other places that cannot import each
-- other: NOTIFICATION_TYPES.defaults in app/src/lib/notificationPrefs.ts (which
-- decides what the chip looks like before any row exists, and is unit-tested)
-- and the `pref?.email ?? true` in the friend-request-email function (which
-- re-reads the preference because pg_net is asynchronous). Change one, change
-- all three: a disagreement here is mail sent to someone whose Settings says it
-- won't be, or the reverse.
--
-- ── the Imports toggle ───────────────────────────────────────────────────────
-- Dropped from Settings, so its rows are dropped too — the same treatment 0059
-- gave `premiere`. A stored preference with no way to see or change it is state
-- that quietly does something forever; anyone who had switched imports off would
-- have stayed switched off with the switch gone. The importer reads the absent
-- row as "notify" (its coalesce is unchanged), so this restores everyone to the
-- behaviour the UI now implies: an import finishing always lands in the inbox.

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
  -- Absent row = both channels on. See the header before changing either.
  v_inapp := coalesce(v_inapp, true);
  v_email := coalesce(v_email, true);

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

delete from public.notification_prefs where type = 'import_done';
