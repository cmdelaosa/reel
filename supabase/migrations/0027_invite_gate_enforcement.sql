-- 0027_invite_gate_enforcement.sql
-- Enforce the invite gate server-side. Until now "invite-only" was enforced
-- only by client React routing: enable_signup=true means any email can complete
-- a magic-link login and hold a valid `authenticated` JWT, and every user-data
-- write policy gated on `user_id = auth.uid()` alone — never on is_invited().
-- So an un-invited (never-redeemed) account could still insert unbounded rows
-- and upload files, burning free-tier DB/storage quota. RLS still walled off
-- OTHER users' data; this closes the self-account cost/abuse hole.
--
-- Fix: re-create every user-data WRITE policy with an added
-- `and public.is_invited((select auth.uid()))` in WITH CHECK. Reads are left
-- open (they only ever expose the caller's own rows, of which an un-invited
-- account has none). redeem_invite() is SECURITY DEFINER and untouched, so an
-- un-invited user can still redeem a code to become invited. Edge functions
-- (tmdb-proxy, importer, export) get the matching 403 check in their own code.
--
-- Onboarding is unaffected: the client redeems the invite (RequireInvited)
-- BEFORE collecting a handle/avatar (RequireOnboarded), so by the time any
-- write happens the account is already invited.

-- ── library_entries / watch_events / ratings (0003, FOR ALL) ──
drop policy "library_entries: owner all" on public.library_entries;
create policy "library_entries: owner all"
  on public.library_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

drop policy "watch_events: owner all" on public.watch_events;
create policy "watch_events: owner all"
  on public.watch_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

drop policy "ratings: owner all" on public.ratings;
create policy "ratings: owner all"
  on public.ratings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

-- ── notification_prefs (0004, FOR ALL) ──
drop policy "notification_prefs: owner all" on public.notification_prefs;
create policy "notification_prefs: owner all"
  on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

-- ── ignored_titles (0022, FOR ALL) ──
drop policy "ignored: owner manages own" on public.ignored_titles;
create policy "ignored: owner manages own"
  on public.ignored_titles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

-- ── import_jobs (0004, INSERT) ──
drop policy "import_jobs: owner inserts own" on public.import_jobs;
create policy "import_jobs: owner inserts own"
  on public.import_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_invited((select auth.uid())));

-- ── friendships (0004, INSERT — requester opens pending) ──
-- Preserve the original predicate and AND the invite check onto it.
drop policy "friendships: requester opens pending" on public.friendships;
create policy "friendships: requester opens pending"
  on public.friendships for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select auth.uid()) in (a, b)
    and status = 'pending'
    and public.is_invited((select auth.uid()))
  );

-- ── storage: avatars + imports uploads (0005, 0013, INSERT) ──
drop policy "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_invited((select auth.uid()))
  );

drop policy "imports: owner insert" on storage.objects;
create policy "imports: owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_invited((select auth.uid()))
  );
