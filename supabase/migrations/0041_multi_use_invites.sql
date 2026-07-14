-- 0041_multi_use_invites.sql
-- Multi-use invite links. A code flagged multi_use can be redeemed by any
-- number of new users until it expires; each redemption is recorded in
-- invite_redemptions and creates accepted friendships with the inviter AND
-- with every previous redeemer of the same code (group effect).
--
-- Single-use codes are untouched: same UPDATE-based claim, same RPCs, same UI.
-- Multi-use codes are provisioned manually (no RPC/UI yet) and are excluded
-- from the 10-unused cap and from rpc_my_invites so the existing invite UI
-- behaves exactly as before.

alter table public.invites
  add column multi_use boolean not null default false;

-- ============================================================
-- invite_redemptions — one row per (multi-use code, redeemer).
-- No client grants: all writes/reads go through security-definer functions.
-- ============================================================
create table public.invite_redemptions (
  code        text not null references public.invites(code) on delete cascade,
  redeemed_by uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, redeemed_by)
);

create index invite_redemptions_redeemed_by_idx
  on public.invite_redemptions (redeemed_by);

alter table public.invite_redemptions enable row level security;
revoke all on public.invite_redemptions from anon, authenticated;

-- ============================================================
-- is_invited — a multi-use redemption also passes the invite gate.
-- ============================================================
create or replace function public.is_invited(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.invites where used_by = uid)
      or exists (select 1 from public.invite_redemptions where redeemed_by = uid);
$$;

-- ============================================================
-- redeem_invite — branch on multi_use. The SELECT ... FOR UPDATE on the
-- invites row serializes concurrent redemptions of the same multi-use code,
-- so each redeemer reliably sees all prior redemptions when building the
-- friendship fan-out.
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
end;
$$;

-- ============================================================
-- Keep the single-use invite UI/caps blind to multi-use codes: they never
-- count against the 10-unused cap and never show in the invites list.
-- ============================================================
create or replace function public.unused_invite_count(uid uuid)
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::int from public.invites
   where created_by = uid
     and used_by is null
     and not multi_use
     and uid = (select auth.uid());
$$;

create or replace function public.rpc_create_invite()
returns public.invites
language plpgsql
security invoker
as $$
declare
  v_row public.invites;
begin
  if (select count(*) from public.invites
        where created_by = auth.uid() and used_by is null and not multi_use) >= 10 then
    raise exception 'You can have at most 10 unused invites at a time.'
      using errcode = 'P0003';
  end if;
  -- readable, unlikely to collide; retry once on the off chance
  for i in 1..3 loop
    begin
      insert into public.invites (code, created_by, expires_at)
      values ('REEL-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
              auth.uid(), now() + interval '30 days')
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- try again with a fresh code
    end;
  end loop;
  raise exception 'could not allocate an invite code, try again';
end;
$$;

create or replace function public.rpc_my_invites()
returns table (
  code text,
  status text,
  used_by_handle text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    i.code,
    case
      when i.used_by is not null then 'used'
      when i.expires_at is not null and i.expires_at < now() then 'expired'
      else 'unused'
    end,
    p.handle::text,
    i.expires_at,
    i.created_at
  from public.invites i
  left join public.profiles p on p.id = i.used_by
  where i.created_by = auth.uid()
    and not i.multi_use
  order by i.created_at desc
$$;
