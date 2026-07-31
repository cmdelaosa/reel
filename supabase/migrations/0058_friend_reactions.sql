-- 0058_friend_reactions.sql
-- Reactions on the activity feed: one emoji per person per row.
--
-- The feed is a derived union that no table owns, so a reaction needs a stable
-- name for a row. rpc_friend_activity (v3) now mints that name itself:
--
--   w:<actor>:<title>:<yyyy-mm-dd>   one day's episodes of one show
--   r:<actor>:<title>                a rating
--   a:<actor>:<title>                an add to the watchlist
--
-- Two consequences of moving the burst grouping here from the client (it used
-- to collapse same-day episodes in JS):
--   * the day bucket is Europe/Madrid, not the viewer's zone, so two friends in
--     different zones react to the SAME row instead of splitting it in two.
--     Every country Reel offers sits on CET (app/src/lib/countries.ts).
--   * a burst cut by the row limit keeps its key (actor+title+day), so a
--     partial group still carries the reactions of the whole one.
--
-- v3 also folds the caller's own events into the feed. With reactions the feed
-- is the group's wall, and you cannot see what people leave on your rows if
-- your rows are not in it.

-- ============================================================
-- activity_reactions — who reacted with what, on which feed row.
-- ============================================================
create table public.activity_reactions (
  event_key  text not null
               check (event_key ~ '^[wra]:[0-9a-f-]{36}:[0-9a-f-]{36}(:\d{4}-\d{2}-\d{2})?$'),
  -- who reacts
  user_id    uuid not null references public.profiles on delete cascade,
  -- whose event it is: denormalized so visibility and the notification target
  -- are one column lookup instead of parsing event_key.
  actor_id   uuid not null references public.profiles on delete cascade,
  -- what the event is about, for the notification payload
  title_id   uuid not null references public.titles on delete cascade,
  emoji      text not null check (emoji in ('❤️', '🔥', '😂', '😱', '🍿', '💤', '💩')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one reaction per person per row: re-tapping changes it, it never stacks
  primary key (user_id, event_key)
);

create index activity_reactions_event_idx on public.activity_reactions (event_key);
create index activity_reactions_actor_idx on public.activity_reactions (actor_id);

alter table public.activity_reactions enable row level security;
revoke all on public.activity_reactions from anon, authenticated;
grant select, insert, update, delete on public.activity_reactions to authenticated;

-- Whoever can see the event sees every reaction on it, including reactions by
-- people they are not friends with — otherwise the counts would lie. Names and
-- faces of those strangers come from rpc_event_reactions, not from a widened
-- read on profiles.
create policy "activity_reactions: visible with the event"
  on public.activity_reactions for select to authenticated
  using (
    actor_id = (select auth.uid())
    or public.is_friend((select auth.uid()), actor_id)
  );

create policy "activity_reactions: react to what you can see"
  on public.activity_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (actor_id = (select auth.uid()) or public.is_friend((select auth.uid()), actor_id))
  );

create policy "activity_reactions: change your own"
  on public.activity_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "activity_reactions: remove your own"
  on public.activity_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- rpc_friend_activity v3 — self included, bursts grouped, keys minted.
-- Same envelope as 0040 plus event_key / title_id / the burst's range and size.
-- security INVOKER, so the 0015 friend-read RLS still gates every source.
-- ============================================================

-- The feed now reads the caller's own watch history too — by far the biggest
-- source — and it reads it newest-first. Nothing indexed that before.
create index if not exists watch_events_user_watched_idx
  on public.watch_events (user_id, watched_at desc);

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
  rated as (
    select r.user_id as fid, 'rated' as verb, t.id as title_id, t.tmdb_id,
           t.name, t.poster_path, r.score::int as score,
           null::int as season_number, null::int as episode_number,
           null::int as to_season, null::int as to_episode, 1 as ep_count,
           r.created_at as at,
           'r:' || r.user_id || ':' || t.id as event_key
    from circle c
    join public.ratings r on r.user_id = c.fid and r.title_id is not null
    join public.titles t on t.id = r.title_id
    order by r.created_at desc
    limit p_limit
  ),
  added as (
    select le.user_id, 'added', t.id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           null::int, null::int,
           null::int, null::int, 1,
           le.added_at,
           'a:' || le.user_id || ':' || t.id
    from circle c
    join public.library_entries le on le.user_id = c.fid and le.followed
    join public.titles t on t.id = le.title_id
    -- added_at is nullable (0036 backfilled it); desc puts nulls first, and a
    -- dateless row would squat at the top of the feed forever.
    where le.added_at is not null
    order by le.added_at desc
    limit p_limit
  ),
  -- Grouping collapses many rows into one, so pull raw events generously —
  -- otherwise one long binge could eat the whole page on its own.
  watched_raw as (
    select wv.user_id as fid, e.title_id,
           e.season_number, e.episode_number, wv.watched_at,
           (wv.watched_at at time zone 'Europe/Madrid')::date as day
    from circle c
    join public.watch_events wv on wv.user_id = c.fid
    join public.episodes e on e.id = wv.episode_id and e.season_number > 0
    order by wv.watched_at desc
    limit p_limit * 8
  ),
  watched as (
    select w.fid, 'watched', t.id, t.tmdb_id,
           t.name, t.poster_path, null::int,
           (array_agg(w.season_number  order by w.season_number, w.episode_number))[1],
           (array_agg(w.episode_number order by w.season_number, w.episode_number))[1],
           (array_agg(w.season_number  order by w.season_number desc, w.episode_number desc))[1],
           (array_agg(w.episode_number order by w.season_number desc, w.episode_number desc))[1],
           count(*)::int,
           max(w.watched_at),
           'w:' || w.fid || ':' || w.title_id || ':' || to_char(w.day, 'YYYY-MM-DD')
    from watched_raw w
    join public.titles t on t.id = w.title_id
    group by w.fid, w.title_id, w.day, t.id, t.tmdb_id, t.name, t.poster_path
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
-- friend of whoever does.
-- ============================================================
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
           p.display_name, p.avatar_url
    from public.activity_reactions r
    join public.profiles p on p.id = r.user_id
    where r.event_key = any(p_keys)
      and (r.actor_id = auth.uid() or public.is_friend(auth.uid(), r.actor_id))
  ) x;
$$;

grant execute on function public.rpc_event_reactions(text[]) to authenticated;

-- ============================================================
-- One notification per event, not per reaction: the row is rewritten as people
-- pile on ("Ana and Leo reacted…"), comes back unread, and jumps to the top.
-- ============================================================
create unique index notifications_reaction_event_idx
  on public.notifications (user_id, (payload->>'event_key'))
  where type = 'reaction';

create function public.notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key      text := coalesce(new.event_key, old.event_key);
  v_actor    uuid := coalesce(new.actor_id, old.actor_id);
  v_reactors jsonb;
  v_name     text;
  v_tmdb     int;
begin
  -- Rebuilt from scratch on every change, so removing a reaction shrinks the
  -- notification the same way adding one grows it. Your own reaction on your
  -- own row never counts.
  select jsonb_agg(jsonb_build_object('id', r.user_id, 'name', p.display_name, 'emoji', r.emoji)
                   order by r.created_at),
         max(t.name), max(t.tmdb_id)
    into v_reactors, v_name, v_tmdb
    from public.activity_reactions r
    join public.profiles p on p.id = r.user_id
    join public.titles t on t.id = r.title_id
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

  insert into public.notifications (user_id, type, payload)
  values (v_actor, 'reaction', jsonb_build_object(
            'event_key', v_key, 'tmdb_id', v_tmdb, 'show_name', v_name, 'reactors', v_reactors))
  on conflict (user_id, (payload->>'event_key')) where type = 'reaction'
  do update set payload = excluded.payload, read_at = null, created_at = now();

  return null;
end;
$$;

create trigger on_activity_reaction
  after insert or update or delete on public.activity_reactions
  for each row execute function public.notify_reaction();
