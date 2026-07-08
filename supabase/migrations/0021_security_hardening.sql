-- 0021_security_hardening.sql
-- Fixes from the Phase-5 security review. Additive (never edits merged
-- migrations); CREATE OR REPLACE keeps function signatures unchanged.

-- ── FINDING 1 (critical): friendship fabrication ────────────────────────────
-- The 0004 "accept" UPDATE policy validated the new row's shape but never
-- pinned a / b / requested_by to their old values, so a participant of ANY
-- pending row could rewrite it into an accepted friendship with an arbitrary
-- third party (who never consented) — granting friend-read access to their
-- data. RLS WITH CHECK can't compare OLD vs NEW, so enforce immutability with a
-- BEFORE UPDATE trigger: only status + accepted_at may change.
create function public.friendships_guard()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.a is distinct from old.a
     or new.b is distinct from old.b
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'friendship identity columns are immutable' using errcode = 'P0004';
  end if;
  return new;
end;
$$;

create trigger friendships_immutable
  before update on public.friendships
  for each row execute function public.friendships_guard();

-- ── FINDING 2 (high): private friend's activity leak ────────────────────────
-- rpc_my_friendships is security definer (bypasses RLS) and returned an
-- accepted friend's latest watch without checking privacy. A private accepted
-- friend's activity must stay hidden, like everywhere else. Add the not-private
-- gate to the watching lateral.
create or replace function public.rpc_my_friendships()
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
    where wv.user_id = other.id
      and f.status = 'accepted'
      and not public.profile_is_private(other.id)
      and e.season_number > 0
    order by wv.watched_at desc
    limit 1
  ) w on true
  order by (f.status = 'pending' and f.requested_by <> me.uid) desc, other.display_name
$$;

-- ── FINDING 3 (low): invites used_by injection ──────────────────────────────
-- An invited user could INSERT an invite with used_by pre-set to any profile
-- id, granting is_invited() to that user outside redeem_invite + the cap. Pin
-- used_by null on insert.
drop policy if exists "invites: invited users create own" on public.invites;
create policy "invites: invited users create own"
  on public.invites for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and used_by is null
    and public.is_invited((select auth.uid()))
  );

-- ── FINDING 5 (low): stats counted specials ─────────────────────────────────
-- episodes_watched / minutes_watched included season-0 specials, unlike every
-- other derivation ("specials excluded"). Filter season_number > 0 so the stat
-- card agrees with the per-show rollups.
create or replace function public.rpc_user_stats()
returns table (
  episodes_watched bigint,
  minutes_watched bigint,
  shows_followed bigint,
  coming_soon bigint,
  avg_rating numeric,
  friends bigint
)
language sql
security invoker
stable
as $$
  select
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
      where w.user_id = (select auth.uid()) and e.season_number > 0),
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and e.season_number > 0),
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed),
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed
        and not exists (
          select 1 from public.episodes e
          where e.title_id = le.title_id
            and e.season_number > 0
            and e.air_datetime <= now())),
    (select round(avg(r.score)::numeric, 1)
       from public.ratings r
      where r.user_id = (select auth.uid())),
    (select count(*)
       from public.friendships f
      where f.status = 'accepted'
        and (select auth.uid()) in (f.a, f.b))
$$;
