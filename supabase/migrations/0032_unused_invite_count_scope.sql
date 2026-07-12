-- 0032_unused_invite_count_scope.sql
-- PR #1 review fix. unused_invite_count(uid) (0030) is SECURITY DEFINER and
-- granted to authenticated with a free uid parameter, so any signed-in user
-- could count any other user's unused invites — a small but needless leak. The
-- invites INSERT policy only ever calls it with auth.uid(), so pin the count to
-- the caller: any other uid now reports 0. New migration (not an edit to 0030)
-- because 0030 is already applied to validation stacks.
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
     and uid = (select auth.uid());
$$;
