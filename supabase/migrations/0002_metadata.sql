-- 0002_metadata.sql
-- TMDB metadata cache: titles / seasons / episodes.
-- Read: authenticated only (the app is auth-gated). Writes: exclusively from
-- Edge Functions via the service-role key, which bypasses RLS (P0-C9).
-- See docs/ARCHITECTURE.md → Metadata cache.

-- ============================================================
-- titles
-- ============================================================
create table public.titles (
  id                uuid primary key default gen_random_uuid(),
  tmdb_id           int not null unique,
  kind              text not null check (kind in ('tv','movie')),  -- movie-ready; TV-only UI in v1
  name              text not null,
  overview          text,
  poster_path       text,
  backdrop_path     text,
  first_air_date    date,
  status            text,                                          -- TMDB: Returning Series | Ended | …
  genres            text[] not null default '{}',
  network           text,                                          -- primary network display name
  episode_run_time  int,
  vote_average      numeric,
  popularity        numeric,
  last_refreshed_at timestamptz
);
-- titles(tmdb_id) lookups are served by the UNIQUE constraint's index; a
-- separate index would just duplicate it.

-- ============================================================
-- seasons
-- ============================================================
create table public.seasons (
  id            uuid primary key default gen_random_uuid(),
  title_id      uuid not null references public.titles on delete cascade,
  tmdb_id       int,
  number        int not null,                                      -- season 0 = specials (stored, excluded from derivations)
  name          text,
  episode_count int,
  air_date      date,
  unique (title_id, number)
);
-- seasons(title_id) lookups are served by the UNIQUE (title_id, number) index.

-- ============================================================
-- episodes
-- ============================================================
create table public.episodes (
  id             uuid primary key default gen_random_uuid(),
  title_id       uuid not null references public.titles on delete cascade,
  season_id      uuid references public.seasons on delete cascade,
  tmdb_id        int,
  season_number  int not null,
  episode_number int not null,
  name           text,
  overview       text,
  runtime        int,
  air_datetime   timestamptz,                                      -- UTC; client renders local
  unique (title_id, season_number, episode_number)
);
-- (title_id, season_number, episode_number) lookups served by the UNIQUE index.
-- New indexes: calendar/up-next scans by air date, and the season FK (unindexed
-- FKs slow cascade deletes + season→episode joins).
create index episodes_title_air_idx on public.episodes (title_id, air_datetime);
create index episodes_season_idx on public.episodes (season_id);

-- ============================================================
-- RLS + grants. authenticated may read the whole cache; nobody writes through
-- the Data API. service_role (Edge Functions) writes, bypassing RLS. Grants are
-- deterministic (revoke-all then grant-specific) so behaviour matches whether
-- or not the hosted "auto-expose new tables" flag is on.
-- ============================================================
alter table public.titles   enable row level security;
alter table public.seasons  enable row level security;
alter table public.episodes enable row level security;

revoke all on public.titles, public.seasons, public.episodes from anon, authenticated;
grant select on public.titles, public.seasons, public.episodes to authenticated;
grant all on public.titles, public.seasons, public.episodes to service_role;

create policy "titles: authenticated read"
  on public.titles for select to authenticated using (true);
create policy "seasons: authenticated read"
  on public.seasons for select to authenticated using (true);
create policy "episodes: authenticated read"
  on public.episodes for select to authenticated using (true);
