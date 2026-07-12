-- 0031_find_profile_privacy.sql
-- C2: rpc_find_profile resolved ANY handle to id/display_name/avatar, ignoring
-- profiles.is_private — so a user who set themselves private was still findable
-- by handle by any authenticated user. Every friend-read policy honors
-- is_private; this RPC didn't. Return a private profile only to an existing
-- friend (so friend features keep working), never to a stranger.
create or replace function public.rpc_find_profile(p_handle text)
returns table (id uuid, handle text, display_name text, avatar_url text)
language sql
security definer
set search_path = ''
stable
as $$
  select id, handle::text, display_name, avatar_url
  from public.profiles
  where handle = p_handle::extensions.citext
    and id <> auth.uid()
    and (not is_private or public.is_friend(auth.uid(), id))
$$;
