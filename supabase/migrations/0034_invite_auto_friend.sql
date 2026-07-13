-- 0034_invite_auto_friend.sql
-- Redeeming an invite now also creates an accepted friendship between the
-- inviter and the new user — if you shared your code with someone, you already
-- know each other, so the request/accept handshake is pointless friction.
--
-- redeem_invite() is SECURITY DEFINER, so the friendship insert bypasses the
-- friendships RLS state machine (which otherwise forbids inserting `accepted`
-- rows directly). An existing pending request between the pair is upgraded to
-- accepted instead of erroring.
--
-- Also backfills friendships for invites redeemed before this migration.

create or replace function public.redeem_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_inviter uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One gate per user: already-invited users cannot burn another code.
  if public.is_invited(v_uid) then
    raise exception 'already invited' using errcode = 'P0001';
  end if;

  update public.invites
     set used_by = v_uid
   where code = p_code
     and used_by is null
     and (expires_at is null or expires_at > now())
  returning created_by into v_inviter;

  if not found then
    raise exception 'invalid or expired invite code' using errcode = 'P0002';
  end if;

  -- created_by is null when the inviter's profile was deleted (FK set null)
  -- or for admin-seeded codes with no creator.
  if v_inviter is not null and v_inviter <> v_uid then
    insert into public.friendships (a, b, requested_by, status, accepted_at)
    values (least(v_inviter, v_uid), greatest(v_inviter, v_uid), v_inviter, 'accepted', now())
    on conflict (a, b) do update
      set status      = 'accepted',
          accepted_at = coalesce(public.friendships.accepted_at, now());
  end if;
end;
$$;

-- Backfill: one accepted friendship per inviter/invitee pair already on record.
-- DISTINCT ON collapses reciprocal invites (x invited y AND y invited x) that
-- would otherwise make the insert hit the same (a, b) row twice.
with pairs as (
  select distinct on (least(created_by, used_by), greatest(created_by, used_by))
         least(created_by, used_by)    as a,
         greatest(created_by, used_by) as b,
         created_by                    as requested_by
    from public.invites
   where created_by is not null
     and used_by is not null
     and created_by <> used_by
   order by least(created_by, used_by), greatest(created_by, used_by), created_at
)
insert into public.friendships (a, b, requested_by, status, accepted_at)
select a, b, requested_by, 'accepted', now()
  from pairs
on conflict (a, b) do update
  set status      = 'accepted',
      accepted_at = coalesce(public.friendships.accepted_at, now());
