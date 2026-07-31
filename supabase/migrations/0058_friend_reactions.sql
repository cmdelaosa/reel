-- 0058_friend_reactions.sql
-- Reactions on the activity feed: one emoji per person per row.
--
-- The feed is a derived union that no table owns, so a reaction needs a stable
-- name for a row. rpc_friend_activity (v3) mints that name itself:
--
--   w:<actor>:<title>:<yyyy-mm-dd>   one day's episodes of one show
--   r:<actor>:<title>                a rating
--   a:<actor>:<title>                an add to the watchlist
--
-- The key is the whole security model of this table, so nothing about it is
-- taken from the client: a before-insert trigger derives actor_id and title_id
-- FROM the key, and the write policy refuses keys that name no real event
-- (activity_event_exists). Without both, any friend could post a key naming a
-- show you never watched and have the trigger deliver it to your inbox.
--
-- Two consequences of moving the burst grouping here from the client (it used
-- to collapse same-day episodes in JS):
--   * the day bucket is Europe/Madrid, not the viewer's zone, so two friends in
--     different zones react to the SAME row instead of splitting it in two.
--     Every country Reel offers sits on CET (app/src/lib/countries.ts).
--   * the row's episode count and range are aggregated over the whole day, not
--     over whatever slice of it the feed's row budget happened to reach.
--
-- v3 also folds the caller's own events into the feed. With reactions the feed
-- is the group's wall, and you cannot see what people leave on your rows if
-- your rows are not in it. That makes the caller — by far the biggest history
-- in the circle — a source that must never crowd the others out, hence the
-- per-member LATERAL windows below rather than one global one.

-- ============================================================
-- activity_reactions — who reacted with what, on which feed row.
-- ============================================================
create table public.activity_reactions (
  event_key  text not null
               check (event_key ~ '^[wra]:[0-9a-f-]{36}:[0-9a-f-]{36}(:\d{4}-\d{2}-\d{2})?$'),
  -- who reacts
  user_id    uuid not null references public.profiles on delete cascade,
  -- whose event it is, and what it is about. Both DERIVED from event_key by
  -- the before-trigger below — never trusted from the client — so that RLS and
  -- the notification address the event the key actually names.
  actor_id   uuid not null references public.profiles on delete cascade,
  title_id   uuid not null references public.titles on delete cascade,
  emoji      text not null check (emoji in ('❤️', '🔥', '😂', '😱', '🍿', '💤', '💩')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one reaction per person per row: re-tapping changes it, it never stacks
  primary key (user_id, event_key)
);

create index activity_reactions_event_idx on public.activity_reactions (event_key);
create index activity_reactions_actor_idx on public.activity_reactions (actor_id);

-- Does this key name an event that actually happened? security definer because
-- the caller cannot read a friend's rows through RLS in every case, and the
-- answer must not depend on who is asking.
create function public.activity_event_exists(p_key text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select case split_part(p_key, ':', 1)
    when 'r' then exists (
      select 1 from public.ratings r
      where r.user_id = split_part(p_key, ':', 2)::uuid
        and r.title_id = split_part(p_key, ':', 3)::uuid)
    when 'a' then exists (
      select 1 from public.library_entries le
      where le.user_id = split_part(p_key, ':', 2)::uuid
        and le.title_id = split_part(p_key, ':', 3)::uuid
        and le.followed)
    when 'w' then exists (
      select 1 from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = split_part(p_key, ':', 2)::uuid
        and e.title_id = split_part(p_key, ':', 3)::uuid
        -- text compare, not a ::date cast: a malformed key must return false,
        -- not raise inside a row-level security check.
        and to_char((wv.watched_at at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')
              = split_part(p_key, ':', 4))
    else false end;
$$;

grant execute on function public.activity_event_exists(text) to authenticated;

create function public.activity_reaction_target()
returns trigger
language plpgsql
as $$
begin
  -- Shape first: a malformed key must fail the column CHECK with its own
  -- message rather than a cast error from here.
  if new.event_key ~ '^[wra]:[0-9a-f-]{36}:[0-9a-f-]{36}(:\d{4}-\d{2}-\d{2})?$' then
    new.actor_id := split_part(new.event_key, ':', 2)::uuid;
    new.title_id := split_part(new.event_key, ':', 3)::uuid;
  end if;
  return new;
end;
$$;

create trigger set_activity_reaction_target
  before insert or update on public.activity_reactions
  for each row execute function public.activity_reaction_target();

alter table public.activity_reactions enable row level security;
revoke all on public.activity_reactions from anon, authenticated;
grant select, insert, update, delete on public.activity_reactions to authenticated;

-- Whoever can see the event sees every reaction on it, including reactions by
-- people they are not friends with — otherwise the counts would lie. The gate
-- is the event's owner, and it carries 0015's not-private conjunct: a profile
-- that went private stops answering questions about what it watched, including
-- "does this event exist", which a bare is_friend() would leak.
create policy "activity_reactions: visible with the event"
  on public.activity_reactions for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (public.is_friend((select auth.uid()), actor_id)
        and not public.profile_is_private(actor_id))
  );

-- is_invited is 0027's gate on every user-data write; without it an
-- authenticated-but-never-invited account can burn quota here, and worse,
-- reach other people's inboxes through the notification trigger.
create policy "activity_reactions: react to what you can see"
  on public.activity_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_invited((select auth.uid()))
    and (actor_id = (select auth.uid())
         or (public.is_friend((select auth.uid()), actor_id)
             and not public.profile_is_private(actor_id)))
    and public.activity_event_exists(event_key)
  );

create policy "activity_reactions: change your own"
  on public.activity_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_invited((select auth.uid()))
    and (actor_id = (select auth.uid())
         or (public.is_friend((select auth.uid()), actor_id)
             and not public.profile_is_private(actor_id)))
    and public.activity_event_exists(event_key)
  );

create policy "activity_reactions: remove your own"
  on public.activity_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- rpc_friend_activity v3 — self included, bursts grouped, keys minted.
-- Same envelope as 0040 plus event_key / title_id / the burst's range and size.
-- security INVOKER, so the 0015 friend-read RLS still gates every source.
-- ============================================================

-- The feed now reads the caller's own watch history too — by far the biggest
-- source — and reads every member's newest-first. Nothing indexed that before.
create index if not exists watch_events_user_watched_idx
  on public.watch_events (user_id, watched_at desc);
-- Same story for the "added" branch, which had only (user_id) where followed.
create index if not exists library_entries_user_added_idx
  on public.library_entries (user_id, added_at desc) where followed;

create or replace function public.rpc_friend_activity(p_limit int default 30)
returns jsonb
language sql
security invoker
stable
as $$
  with circle as (
    select case when f.a = (select auth.uid()) then f.b else f.a end as fid
    from public.friendships f
    where f.status = 'accepted' and (select auth.uid()) in (f.a, f.b)
    union
    select (select auth.uid())
  ),
  -- Every source takes its rows per circle member, not from one global window:
  -- one person marking a 500-episode show watched must not evict everyone else
  -- from the feed.
  rated as (
    select x.fid as fid, 'rated' as verb, x.title_id as title_id, t.tmdb_id as tmdb_id,
           t.name as name, t.poster_path as poster_path, x.score as score,
           null::int as season_number, null::int as episode_number,
           null::int as to_season, null::int as to_episode, 1 as ep_count,
           x.at as at, ('r:' || x.fid || ':' || x.title_id) as event_key
    from circle c
    cross join lateral (
      select c.fid as fid, rr.title_id as title_id, rr.score::int as score, rr.created_at as at
      from public.ratings rr
      where rr.user_id = c.fid and rr.title_id is not null
      order by rr.created_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  added as (
    select x.fid, 'added', x.title_id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           null::int, null::int, null::int, null::int, 1,
           x.at, ('a:' || x.fid || ':' || x.title_id)
    from circle c
    cross join lateral (
      select c.fid as fid, le.title_id as title_id, le.added_at as at
      from public.library_entries le
      where le.user_id = c.fid and le.followed
      order by le.added_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  -- Two stages for the bursts: a bounded window to DISCOVER which (person,
  -- show, day) rows are recent…
  watched_window as (
    select w.fid, w.title_id, w.day, max(w.watched_at) as at
    from circle c
    cross join lateral (
      select c.fid as fid, e.title_id as title_id, wv.watched_at as watched_at,
             (wv.watched_at at time zone 'Europe/Madrid')::date as day
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = c.fid
      order by wv.watched_at desc
      limit p_limit * 8
    ) w
    group by w.fid, w.title_id, w.day
    order by max(w.watched_at) desc
    limit p_limit
  ),
  -- …then an exact count over the WHOLE day for the few rows that survive.
  -- Counting inside the discovery window instead would report "E7–E12 · 6" for
  -- a twelve-episode day whenever the window happened to cut it in half.
  watched as (
    select g.fid, 'watched', g.title_id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           f.from_season, f.from_episode, f.to_season, f.to_episode, f.ep_count,
           g.at, ('w:' || g.fid || ':' || g.title_id || ':' || to_char(g.day, 'YYYY-MM-DD'))
    from watched_window g
    join public.titles t on t.id = g.title_id
    cross join lateral (
      select (array_agg(e.season_number  order by e.season_number, e.episode_number))[1] as from_season,
             (array_agg(e.episode_number order by e.season_number, e.episode_number))[1] as from_episode,
             (array_agg(e.season_number  order by e.season_number desc, e.episode_number desc))[1] as to_season,
             (array_agg(e.episode_number order by e.season_number desc, e.episode_number desc))[1] as to_episode,
             count(*)::int as ep_count
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = g.fid
        and e.title_id = g.title_id
        and wv.watched_at >= (g.day::timestamp at time zone 'Europe/Madrid')
        and wv.watched_at <  ((g.day + 1)::timestamp at time zone 'Europe/Madrid')
    ) f
  ),
  unioned as (
    select * from rated
    union all select * from added
    union all select * from watched
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  from (
    select p.id as friend_id, p.display_name as friend_name, p.avatar_url as friend_avatar,
           u.verb, u.tmdb_id, u.title_id, u.name as title_name, u.poster_path, u.score,
           u.season_number, u.episode_number, u.to_season, u.to_episode, u.ep_count,
           u.at, u.event_key
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;

grant execute on function public.rpc_friend_activity(int) to authenticated;

-- ============================================================
-- rpc_event_reactions — the reactions on a page of the feed, with the names
-- and faces behind them. security DEFINER: a reaction may come from someone
-- the caller is not friends with, whose profile row they cannot read. The
-- gate is the event, not the reactor — the caller must own the event or be a
-- friend of whoever does (and that owner must not be private).
-- ============================================================
-- May the caller learn who this reactor is? Yourself and your friends always;
-- anyone else only if they are not private. Defined before its caller: a
-- `language sql` body is parsed at creation time.
create function public.reactor_is_nameable(p_reactor uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_reactor = auth.uid()
      or public.is_friend(auth.uid(), p_reactor)
      or not public.profile_is_private(p_reactor);
$$;

create function public.rpc_event_reactions(p_keys text[])
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
  from (
    select r.event_key, r.emoji, r.user_id, r.created_at,
           -- Every reaction counts, but a private profile still doesn't hand
           -- its name and face to a stranger who merely shares a friend with
           -- it: those come back null and render as "Someone".
           case when public.reactor_is_nameable(r.user_id) then p.display_name end as display_name,
           case when public.reactor_is_nameable(r.user_id) then p.avatar_url end as avatar_url
    from public.activity_reactions r
    join public.profiles p on p.id = r.user_id
    where r.event_key = any(p_keys)
      and (r.actor_id = auth.uid()
           or (public.is_friend(auth.uid(), r.actor_id)
               and not public.profile_is_private(r.actor_id)))
  ) x;
$$;

grant execute on function public.rpc_event_reactions(text[]) to authenticated;
grant execute on function public.reactor_is_nameable(uuid) to authenticated;

-- ============================================================
-- One notification per event, not per reaction: the row is rewritten as people
-- pile on ("Ana and Leo reacted…") and deleted when the last one withdraws.
-- ============================================================
create unique index notifications_reaction_event_idx
  on public.notifications (user_id, (payload->>'event_key'))
  where type = 'reaction';

-- A DELETE's old record carries only the columns of the replica identity, and
-- the client subscribes with `user_id=eq.<id>`: under the default (primary key)
-- identity that filter can never match, so the row vanishing would never reach
-- the inbox on screen. This is what makes withdrawal visible live.
alter table public.notifications replica identity full;

create function public.notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key      text := coalesce(new.event_key, old.event_key);
  v_actor    uuid := coalesce(new.actor_id, old.actor_id);
  v_title    uuid := coalesce(new.title_id, old.title_id);
  v_reactors jsonb;
  v_name     text;
  v_tmdb     int;
begin
  -- One writer at a time per event. The payload is rebuilt from a read, and
  -- under READ COMMITTED two reactions committing at once would each read a
  -- snapshot taken before the other's — the second write would then silently
  -- drop a reactor the table actually holds.
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- Rebuilt from scratch on every change, so removing a reaction shrinks the
  -- notification the same way adding one grows it. Your own reaction on your
  -- own row never counts.
  select jsonb_agg(jsonb_build_object(
           'id', r.user_id,
           'name', case when public.is_friend(v_actor, r.user_id)
                          or not public.profile_is_private(r.user_id)
                        then p.display_name end,
           'emoji', r.emoji) order by r.created_at)
    into v_reactors
    from public.activity_reactions r
    join public.profiles p on p.id = r.user_id
   where r.event_key = v_key and r.user_id <> v_actor;

  if v_reactors is null then
    delete from public.notifications
     where user_id = v_actor and type = 'reaction' and payload->>'event_key' = v_key;
    return null;
  end if;

  if not coalesce(
       (select inapp from public.notification_prefs
         where user_id = v_actor and type = 'reaction'), true) then
    return null;
  end if;

  -- The title is a property of the event, not of the reactors: one lookup,
  -- not one per person on the row.
  select t.name, t.tmdb_id into v_name, v_tmdb
    from public.titles t where t.id = v_title;

  insert into public.notifications (user_id, type, payload)
  values (v_actor, 'reaction', jsonb_build_object(
            'event_key', v_key, 'tmdb_id', v_tmdb, 'show_name', v_name, 'reactors', v_reactors))
  on conflict (user_id, (payload->>'event_key')) where type = 'reaction'
  do update set
    payload = excluded.payload,
    -- Only somebody JOINING is news worth re-ringing the bell for. Withdrawing
    -- a reaction, or swapping one emoji for another, updates the row in place
    -- and leaves it read and where it was.
    read_at = case when jsonb_array_length(excluded.payload->'reactors')
                        > jsonb_array_length(notifications.payload->'reactors')
                   then null else notifications.read_at end,
    created_at = case when jsonb_array_length(excluded.payload->'reactors')
                           > jsonb_array_length(notifications.payload->'reactors')
                      then now() else notifications.created_at end;

  return null;
end;
$$;

create trigger on_activity_reaction
  after insert or update or delete on public.activity_reactions
  for each row execute function public.notify_reaction();
