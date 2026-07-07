-- 0005_storage_avatars.sql
-- Avatars: public-read storage bucket, owner-scoped writes (path convention
-- <uid>/avatar.png), plus a handle-availability RPC for onboarding (profiles
-- SELECT is owner-only until Phase 4, so the client can't probe uniqueness).

-- ============================================================
-- avatars bucket — public read; small images only (client resizes to 256px).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Objects live at <uid>/... — the first path segment must be the caller's uid.
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ============================================================
-- handle_available — onboarding uniqueness probe. security definer because
-- profiles SELECT is owner-only; leaks only a boolean for an exact handle.
-- citext comparison → case-insensitive, matching the unique constraint.
-- ============================================================
create function public.handle_available(p_handle text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.profiles
     where handle = p_handle::extensions.citext
       and id <> auth.uid()
  );
$$;

grant execute on function public.handle_available(text) to authenticated;
