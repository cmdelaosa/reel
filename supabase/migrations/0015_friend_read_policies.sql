-- 0015_friend_read_policies.sql
-- Phase 4 opens read access from owner-only to "accepted friends, unless the
-- owner is private". Security-sensitive: friend-read is SELECT-only and always
-- ANDs is_friend with a not-private check. Plus friend search + a friendships
-- listing RPC (both security definer, since a requester/pending user can't read
-- the other profile through the friend-read policy yet).

-- Is this profile private? security definer so callers can evaluate it without
-- needing to read the profile row themselves.
create function public.profile_is_private(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select is_private from public.profiles where id = uid), true);
$$;

grant execute on function public.profile_is_private(uuid) to authenticated;

-- ── friend-read SELECT policies (additive to the owner policies) ─────────────
create policy "profiles: friends read"
  on public.profiles for select to authenticated
  using (public.is_friend((select auth.uid()), id) and not public.profile_is_private(id));

create policy "library_entries: friends read"
  on public.library_entries for select to authenticated
  using (public.is_friend((select auth.uid()), user_id) and not public.profile_is_private(user_id));

create policy "watch_events: friends read"
  on public.watch_events for select to authenticated
  using (public.is_friend((select auth.uid()), user_id) and not public.profile_is_private(user_id));

create policy "ratings: friends read"
  on public.ratings for select to authenticated
  using (public.is_friend((select auth.uid()), user_id) and not public.profile_is_private(user_id));

-- ── friend search: exact handle only (no browsing) ───────────────────────────
create function public.rpc_find_profile(p_handle text)
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
$$;

grant execute on function public.rpc_find_profile(text) to authenticated;

-- ── my friendships: the other party's identity + status + direction, plus
-- what an accepted friend is watching. security definer to surface the other
-- profile even for pending requests. ─────────────────────────────────────────
create function public.rpc_my_friendships()
returns table (
  other_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  status text,
  incoming boolean,
  watching_title text,
  watching_tmdb int,
  watching_season int,
  watching_episode int
)
language sql
security definer
set search_path = ''
stable
as $$
  with me as (select auth.uid() as uid)
  select
    other.id,
    other.handle::text,
    other.display_name,
    other.avatar_url,
    f.status,
    (f.status = 'pending' and f.requested_by <> me.uid) as incoming,
    w.name, w.tmdb_id, w.season_number, w.episode_number
  from me
  join public.friendships f on me.uid in (f.a, f.b)
  join public.profiles other
    on other.id = case when f.a = me.uid then f.b else f.a end
  left join lateral (
    select t.name, t.tmdb_id, e.season_number, e.episode_number
    from public.watch_events wv
    join public.episodes e on e.id = wv.episode_id
    join public.titles t on t.id = e.title_id
    where wv.user_id = other.id and f.status = 'accepted'
    order by wv.watched_at desc
    limit 1
  ) w on true
  order by (f.status = 'pending' and f.requested_by <> me.uid) desc, other.display_name
$$;

grant execute on function public.rpc_my_friendships() to authenticated;

-- ── friend_request notification on a new pending row ─────────────────────────
create function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := case when new.a = new.requested_by then new.b else new.a end;
  v_handle text;
  v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  select handle::text, display_name into v_handle, v_name
    from public.profiles where id = new.requested_by;
  insert into public.notifications (user_id, type, payload)
  values (v_target, 'friend_request',
          jsonb_build_object('from_id', new.requested_by, 'from_handle', v_handle, 'from_name', v_name));
  return new;
end;
$$;

create trigger on_friendship_request
  after insert on public.friendships
  for each row execute function public.notify_friend_request();
