-- 0003_userdata.sql
-- User data: library_entries, watch_events, ratings. Owner-only RLS on all
-- verbs (friend-read policies arrive in Phase 4). The TV Time importer (P0-C10)
-- writes these via the service-role key. See docs/ARCHITECTURE.md → User data.

-- ============================================================
-- library_entries — the one watchlist bit (followed) + favorite/notify.
-- ============================================================
create table public.library_entries (
  user_id   uuid not null references public.profiles on delete cascade,
  title_id  uuid not null references public.titles on delete cascade,
  followed  boolean not null default true,
  favorite  boolean not null default false,
  notify    boolean not null default false,   -- "Notify me" on upcoming titles
  added_at  timestamptz not null default now(),
  primary key (user_id, title_id)
);
-- library_entries(user_id) lookups served by the PK's leading column; the
-- partial index narrows the hot "my followed shows" query.
create index library_entries_followed_idx on public.library_entries (user_id) where followed;
create index library_entries_title_idx on public.library_entries (title_id);  -- FK / "who follows this"

-- ============================================================
-- watch_events — one row per watched episode (v1: no rewatches).
-- ============================================================
create table public.watch_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  episode_id uuid not null references public.episodes on delete cascade,
  watched_at timestamptz not null default now(),
  source     text not null default 'app',     -- app | tvtime_import | seed
  unique (user_id, episode_id)
);
-- watch_events(user_id, episode_id) lookups served by the UNIQUE index.
create index watch_events_episode_idx on public.watch_events (episode_id);  -- FK / cascade

-- ============================================================
-- ratings — show-level (title_id) OR episode-level (episode_id), never both.
-- The two UNIQUEs are null-distinct: one show rating and one episode rating
-- per (user, target). Episode ratings ship after Phase 5 (schema ready now).
-- ============================================================
create table public.ratings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  title_id   uuid references public.titles on delete cascade,
  episode_id uuid references public.episodes on delete cascade,
  score      int not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(title_id, episode_id) = 1),
  unique (user_id, title_id),
  unique (user_id, episode_id)
);
create index ratings_user_created_idx on public.ratings (user_id, created_at desc);
create index ratings_title_idx on public.ratings (title_id);  -- FK / friend "top rated"

-- ============================================================
-- RLS + grants: owner-only CRUD for authenticated; service_role (importer)
-- writes freely. Deterministic grants regardless of the auto-expose flag.
-- ============================================================
alter table public.library_entries enable row level security;
alter table public.watch_events     enable row level security;
alter table public.ratings          enable row level security;

revoke all on public.library_entries, public.watch_events, public.ratings from anon, authenticated;
grant select, insert, update, delete on public.library_entries, public.watch_events, public.ratings to authenticated;
grant all on public.library_entries, public.watch_events, public.ratings to service_role;

create policy "library_entries: owner all"
  on public.library_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "watch_events: owner all"
  on public.watch_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "ratings: owner all"
  on public.ratings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
