-- 0062_invite_pass_on_profile.sql
-- The invite gate is a property of the PERSON, not of the code they came in on.
--
-- is_invited() used to answer by looking at rows the code owns: invites.used_by
-- for single-use codes, invite_redemptions for multi-use ones (0041). Both are
-- collateral of the code — invite_redemptions.code cascades on delete, used_by
-- lives on the invites row itself — so deleting a code silently un-invited
-- everyone who had joined through it.
--
-- That is what happened on 2026-08-01. The three multi-use group links seeded
-- in 0041/0045/0050 were deleted from production to revoke them now that the
-- repo is public; the cascade took every redemption with them. Five accounts,
-- thousands of watched episodes between them, were bounced back to the /invite
-- gate — locked out by app routing, by every is_invited() write policy (0027)
-- and by the tmdb-proxy gate (0042), while their data sat untouched behind it.
--
-- Redeeming is a one-time event in a person's life, so record it on the person:
-- profiles.invited_at is sealed once and never read off the code again. Codes
-- can then be expired, revoked or deleted freely; invites and invite_redemptions
-- keep working exactly as they do, but as history rather than as the gate.

alter table public.profiles
  add column invited_at timestamptz;

comment on column public.profiles.invited_at is
  'When this account passed the invite gate. Sealed once by redeem_invite(), never cleared: the pass outlives the code that granted it.';

-- ============================================================
-- Backfill 1 — everyone the old gate still lets through.
-- ============================================================
update public.profiles p
   set invited_at = coalesce(
         (select min(r.redeemed_at) from public.invite_redemptions r
           where r.redeemed_by = p.id),
         p.created_at)
 where p.invited_at is null
   and (exists (select 1 from public.invites i where i.used_by = p.id)
     or exists (select 1 from public.invite_redemptions r where r.redeemed_by = p.id));

-- ============================================================
-- Backfill 2 — everyone the 2026-08-01 revocation dropped.
--
-- Their redemption rows are gone, so membership is established from what only a
-- member could have left behind: a library. Since 0027, inserting into
-- library_entries requires is_invited(), so a row there is proof the account was
-- past the gate — an account that stalled AT the gate has an empty library,
-- because RLS never let it write one. Bounded to profiles that predate the
-- revocation, so it can only ever readmit people who were already in.
-- ============================================================
update public.profiles p
   set invited_at = p.created_at
 where p.invited_at is null
   and p.created_at < timestamptz '2026-08-01'
   and exists (select 1 from public.library_entries le where le.user_id = p.id);

-- ============================================================
-- is_invited — one lookup, on the person.
-- ============================================================
create or replace function public.is_invited(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
     where id = uid and invited_at is not null
  );
$$;

-- ============================================================
-- Sealing the pass. Both branches of redeem_invite converge here: whichever
-- kind of code was burned, the account is in from now on.
-- ============================================================
create or replace function public.redeem_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_inviter uuid;
  v_multi   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One gate per user: already-invited users cannot burn another code.
  if public.is_invited(v_uid) then
    raise exception 'already invited' using errcode = 'P0001';
  end if;

  select created_by, multi_use
    into v_inviter, v_multi
    from public.invites
   where code = p_code
     and (expires_at is null or expires_at > now())
     and (multi_use or used_by is null)
     for update;

  if not found then
    raise exception 'invalid or expired invite code' using errcode = 'P0002';
  end if;

  if v_multi then
    insert into public.invite_redemptions (code, redeemed_by)
    values (p_code, v_uid);

    -- Friend the inviter plus every earlier redeemer of this code.
    insert into public.friendships (a, b, requested_by, status, accepted_at)
    select least(o.uid, v_uid), greatest(o.uid, v_uid), o.uid, 'accepted', now()
      from (
        select i.created_by as uid
          from public.invites i
         where i.code = p_code
        union
        select r.redeemed_by
          from public.invite_redemptions r
         where r.code = p_code
      ) o
     where o.uid is not null
       and o.uid <> v_uid
    on conflict (a, b) do update
      set status      = 'accepted',
          accepted_at = coalesce(public.friendships.accepted_at, now());
  else
    update public.invites
       set used_by = v_uid
     where code = p_code;

    -- created_by is null when the inviter's profile was deleted (FK set null)
    -- or for admin-seeded codes with no creator.
    if v_inviter is not null and v_inviter <> v_uid then
      insert into public.friendships (a, b, requested_by, status, accepted_at)
      values (least(v_inviter, v_uid), greatest(v_inviter, v_uid), v_inviter, 'accepted', now())
      on conflict (a, b) do update
        set status      = 'accepted',
            accepted_at = coalesce(public.friendships.accepted_at, now());
    end if;
  end if;

  -- The pass itself. Everything above is bookkeeping about the code; this is
  -- the part the gate reads, and nothing after this point can revoke it.
  update public.profiles
     set invited_at = now()
   where id = v_uid
     and invited_at is null;
end;
$$;

-- ============================================================
-- profiles carries a blanket UPDATE grant and an owner-updates-own policy
-- (0001), so without this the gate would be self-serve: any authenticated
-- account could PATCH its own invited_at and walk in. Restricting the grant to
-- a column list would work too, but it has to be restated every time profiles
-- grows a column, and forgetting once reopens this. A trigger holds whatever
-- the column list becomes.
--
-- redeem_invite() is security definer, so current_user inside it is the function
-- owner rather than 'authenticated', and its seal passes through untouched.
-- ============================================================
create function public.profiles_protect_invited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.invited_at := old.invited_at;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_invited_at
  before update on public.profiles
  for each row execute function public.profiles_protect_invited_at();
