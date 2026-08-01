-- 0001_profiles_invites.sql
-- Identity & access: profiles (1:1 with auth.users) + invite-gated signup.
-- See docs/ARCHITECTURE.md → Identity & access; docs/PLAN.md P0-C5.
--
-- Grants are made deterministic (revoke-all then grant-specific) so this
-- migration behaves identically whether or not the hosted project has
-- "auto-expose new tables" ON (that flag is deprecated, removed 2026-10-30).

create extension if not exists citext with schema extensions;

-- ============================================================
-- profiles — extends auth.users; exactly one row per user, created by the
-- signup trigger below. Owner-only access; friend/public read arrives Phase 4.
-- ============================================================
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        extensions.citext unique not null
                  check (handle::text ~ '^[a-z0-9_.]{3,24}$'),
  display_name  text not null,
  avatar_url    text,
  bio           text,
  country       text,
  is_private    boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

-- No INSERT policy: the security-definer signup trigger creates the row.
-- No DELETE policy: profiles cascade-delete from auth.users.
create policy "profiles: owner reads own"
  on public.profiles for select
  using (id = (select auth.uid()));

create policy "profiles: owner updates own"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ============================================================
-- invites — short human codes that gate signup.
-- ============================================================
create table public.invites (
  code        text primary key,
  created_by  uuid references public.profiles on delete set null,
  used_by     uuid references public.profiles on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.invites enable row level security;

revoke all on public.invites from anon, authenticated;
grant select, insert on public.invites to authenticated;

-- ============================================================
-- is_invited — has this user redeemed a code? Used by the invites INSERT
-- policy and by app routing. security definer so it reads invites regardless
-- of the caller's RLS.
-- ============================================================
create function public.is_invited(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.invites where used_by = uid);
$$;

grant execute on function public.is_invited(uuid) to authenticated;

-- You only see codes you created (to share/manage in Phase 3) or the one you
-- redeemed. Redeeming does NOT need select — it goes through redeem_invite().
create policy "invites: see own created or redeemed"
  on public.invites for select
  using (created_by = (select auth.uid()) or used_by = (select auth.uid()));

-- Only already-invited users may mint invites, and only as themselves.
create policy "invites: invited users create own"
  on public.invites for insert
  with check (
    created_by = (select auth.uid())
    and public.is_invited((select auth.uid()))
  );

-- ============================================================
-- redeem_invite — atomically claim an unused, unexpired code for the caller.
-- security definer: flips used_by past the invites RLS. The single UPDATE with
-- `used_by is null` in its WHERE makes a second redemption of the same code a
-- no-match → error, with no race window.
-- ============================================================
create function public.redeem_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
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
     and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'invalid or expired invite code' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;

-- ============================================================
-- handle_new_user — create a profile for every new auth user. Deterministic
-- placeholder handle (16 hex of the uuid → collision-proof, ≤24 chars);
-- onboarding (P1-C4) sets the real handle + display name.
-- ============================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    'user_' || left(replace(new.id::text, '-', ''), 16),
    coalesce(new.raw_user_meta_data ->> 'name', 'New user')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
