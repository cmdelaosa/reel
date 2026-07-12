-- 0030_security_hardening_2.sql
-- Two low/medium hardening fixes from the 2026-07-12 audit.

-- ── C1: invites cap/expiry were enforced only inside rpc_create_invite ───────
-- authenticated has a direct INSERT grant on public.invites, and the INSERT
-- policy (0021) checked only created_by / used_by / is_invited — not the count
-- or expiry. So an invited user could `from('invites').insert(...)` unlimited,
-- never-expiring codes, diluting the app's only admission control. Move the cap
-- (<10 unused) and expiry (≤31d) into the policy so the direct path is bounded
-- too. Consistent with rpc_create_invite (10-cap, 30-day expiry), which passes.
--
-- The unused count comes from a SECURITY DEFINER helper, NOT an inline subquery
-- on public.invites: a policy that selects its own table recurses infinitely.
-- This mirrors is_invited(), already used in this policy without recursion.
create function public.unused_invite_count(uid uuid)
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::int from public.invites where created_by = uid and used_by is null;
$$;
grant execute on function public.unused_invite_count(uuid) to authenticated;

drop policy "invites: invited users create own" on public.invites;
create policy "invites: invited users create own"
  on public.invites for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and used_by is null
    and public.is_invited((select auth.uid()))
    and expires_at is not null
    and expires_at <= now() + interval '31 days'
    and public.unused_invite_count((select auth.uid())) < 10
  );

-- ── C4: avatars bucket was anonymously listable ─────────────────────────────
-- The SELECT policy applied to every role with just `bucket_id = 'avatars'`, so
-- anyone (even signed-out) could list objects and enumerate every user's uuid
-- from the `<uid>/…` object paths. Avatars render via public URLs (public
-- bucket, getPublicUrl) which don't use this policy, and the app never calls
-- .list(), so scope SELECT to the owner's own folder — display is unaffected,
-- enumeration is closed.
drop policy "avatars: public read" on storage.objects;
create policy "avatars: owner lists own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
