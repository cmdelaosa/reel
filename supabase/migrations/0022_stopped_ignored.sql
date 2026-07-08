-- 0022_stopped_ignored.sql
-- Two new library concepts:
--   • stopped — a followed show you keep the history of but have stopped
--     watching (TV Time's "archived"). Excluded from Tonight/up-next/calendar;
--     surfaced under its own filter in My Shows. Notifications turn off with it.
--   • ignored_titles — suggestions dismissed in Explore, never suggested again
--     (client filters every suggestion surface against this; reversible).
-- Also extends rpc_library_rollup with `stopped` and `last_aired_datetime` (for
-- the new My Shows sorts) and excludes stopped shows from the active RPCs.

-- ── stopped flag ────────────────────────────────────────────────────────────
alter table public.library_entries add column stopped boolean not null default false;

-- ── ignored_titles ──────────────────────────────────────────────────────────
create table public.ignored_titles (
  user_id    uuid not null references public.profiles on delete cascade,
  title_id   uuid not null references public.titles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, title_id)
);
alter table public.ignored_titles enable row level security;
revoke all on public.ignored_titles from anon, authenticated;
grant select, insert, delete on public.ignored_titles to authenticated;
grant all on public.ignored_titles to service_role;
create policy "ignored: owner manages own"
  on public.ignored_titles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── rpc_library_rollup — add stopped + last_aired_datetime ───────────────────
-- Signature change (new OUT columns) → drop + recreate.
drop function if exists public.rpc_library_rollup();
create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  name text,
  poster_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  stopped boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  last_aired_datetime timestamptz,
  next_air_datetime timestamptz
)
language sql
security invoker
stable
as $$
  select
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.stopped,
    le.added_at,
    coalesce(a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.last_aired,
    a.next_air
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  left join lateral (
    select count(*) as watched, max(we.watched_at) as last_watched_at
    from public.watch_events we
    join public.episodes e2 on e2.id = we.episode_id
    where we.user_id = (select auth.uid())
      and e2.title_id = t.id
      and e2.season_number > 0
  ) w on true
  where le.user_id = (select auth.uid())
    and le.followed
$$;
grant execute on function public.rpc_library_rollup() to authenticated;

-- ── rpc_up_next — exclude stopped ───────────────────────────────────────────
create or replace function public.rpc_up_next()
returns table (
  title_id uuid, tmdb_id int, name text, poster_path text, network text,
  vote_average numeric, episode_id uuid, season_number int, episode_number int,
  episode_name text, air_datetime timestamptz, aired_count int, watched_count int,
  last_watched_at timestamptz
)
language sql
security invoker
stable
as $$
  select
    t.id, t.tmdb_id, t.name, t.poster_path, t.network, t.vote_average,
    n.id, n.season_number, n.episode_number, n.name, n.air_datetime,
    c.aired::int, c.watched::int, c.last_watched_at
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join lateral (
    select e.id, e.season_number, e.episode_number, e.name, e.air_datetime
    from public.episodes e
    where e.title_id = t.id
      and e.season_number > 0
      and e.air_datetime is not null
      and e.air_datetime <= now()
      and not exists (
        select 1 from public.watch_events wv
        where wv.user_id = (select auth.uid()) and wv.episode_id = e.id
      )
    order by e.season_number, e.episode_number
    limit 1
  ) n on true
  join lateral (
    select
      count(*) filter (where e2.air_datetime <= now() and e2.season_number > 0) as aired,
      count(*) filter (where wv.id is not null) as watched,
      max(wv.watched_at) as last_watched_at
    from public.episodes e2
    left join public.watch_events wv
      on wv.episode_id = e2.id and wv.user_id = (select auth.uid()) and e2.season_number > 0
    where e2.title_id = t.id
  ) c on true
  where le.user_id = (select auth.uid())
    and le.followed
    and not le.stopped
    and c.watched > 0
$$;
grant execute on function public.rpc_up_next() to authenticated;

-- ── rpc_calendar_feed — exclude stopped ─────────────────────────────────────
create or replace function public.rpc_calendar_feed(p_from timestamptz, p_to timestamptz)
returns table (
  episode_id uuid, title_id uuid, tmdb_id int, show_name text, poster_path text,
  network text, season_number int, episode_number int, episode_name text,
  air_datetime timestamptz, is_premiere boolean, is_finale boolean, watch_event_id uuid
)
language sql
security invoker
stable
as $$
  select
    e.id, t.id, t.tmdb_id, t.name, t.poster_path, t.network,
    e.season_number, e.episode_number, e.name, e.air_datetime,
    e.episode_number = 1 as is_premiere,
    e.episode_number = season_last.max_ep as is_finale,
    wv.id
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join public.episodes e
    on e.title_id = t.id
   and e.season_number > 0
   and e.air_datetime is not null
   and e.air_datetime >= p_from
   and e.air_datetime <= p_to
  join lateral (
    select max(e3.episode_number) as max_ep
    from public.episodes e3
    where e3.title_id = e.title_id and e3.season_number = e.season_number
  ) season_last on true
  left join public.watch_events wv
    on wv.episode_id = e.id and wv.user_id = (select auth.uid())
  where le.user_id = (select auth.uid())
    and le.followed
    and not le.stopped
  order by e.air_datetime, t.name, e.episode_number
$$;
grant execute on function public.rpc_calendar_feed(timestamptz, timestamptz) to authenticated;

-- ── rpc_user_stats — count active (non-stopped) follows ─────────────────────
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
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped),
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped
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
