# Architecture

Authoritative technical reference for the production build. Phase specs link here instead of
repeating decisions. If something here conflicts with code, this doc wins until amended.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Client | **Vite + React 19 + TypeScript (strict)**, React Router, TanStack Query, Zod | Latest stable majors at scaffold time (P0-C2: Vite 8, Router 8, Zod 4); the frozen prototype keeps its own older pins. Native app deferred to Phase 6. |
| Styling | Plain CSS with **design tokens as CSS variables** + Tailwind 4 utilities | Port `prototype/src/index.css` glass look (plain CSS — Tailwind-version-independent). `data-theme` / `data-accent` on `<html>`. Tailwind 4 is CSS-first: `@import "tailwindcss"` + `@theme`, `@tailwindcss/vite` plugin, no tailwind.config/postcss. |
| Backend | **Supabase** — Postgres, Auth, RLS, Edge Functions, Storage, Realtime | Free tier. All authorization in RLS; client talks to Postgres directly via supabase-js. |
| Metadata | **TMDB** via an Edge Function proxy | API key never reaches the client. Responses upserted into our cache tables. |
| Email | **Resend** from scheduled Edge Functions | Alerts + magic links (magic links are Supabase-native). |
| Hosting | **Cloudflare Workers** (static assets + SPA fallback), live at [reel-app.com](https://reel-app.com) | Launched on Vercel, migrated later — see [MIGRATION-CLOUDFLARE.md](MIGRATION-CLOUDFLARE.md). |
| Tests | **vitest** (pure logic), **Playwright** (Phase 5 smoke) | Derivations must be unit-tested. |

## Repo layout

```
reel/
├── README.md               start here
├── DESIGN.md               product decisions (what)
├── docs/
│   ├── ARCHITECTURE.md     this file (how)
│   ├── PLAN.md             master execution plan (status table)
│   └── phases/PHASE-N.md   commit specs (do this next)
├── prototype/              FROZEN reference — read, never edit
├── app/                    production web client (created P0-C2)
│   ├── src/
│   │   ├── lib/            supabase client, tmdb client, zod schemas, query keys
│   │   ├── domain/         PURE logic: status/up-next/calendar derivations (unit-tested)
│   │   ├── ui/             design-system pieces (Poster, Stars, Rail, sheets, avatars…)
│   │   ├── features/       route-level screens (tonight/, shows/, explore/, calendar/, you/, auth/)
│   │   └── styles/         tokens.css, glass.css, marquee.css (ported)
│   └── …vite config, tsconfig, eslint, vitest
├── supabase/               created P0-C4
│   ├── migrations/         numbered SQL, never edited after merge — always add a new one
│   ├── functions/          tmdb-proxy/, episode-refresh/, alerts/, importer/
│   └── seed/               dev fixtures
└── scripts/                offline tooling (tvtime-import/)
```

## Environment & secrets

- `app/.env.local` (gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Edge function secrets (`supabase secrets set`): `TMDB_API_KEY`, `RESEND_API_KEY`.
- The author's TV Time zip lives **outside the repo** (`~/tvtime-export/`); scripts take a path arg.
- CI (GitHub Actions): `npm run check` = `tsc --noEmit && eslint . && vitest run` in `app/`.

## Database schema

Conventions: `uuid` PKs (`gen_random_uuid()`), `created_at timestamptz default now()`,
snake_case, FKs `on delete cascade` from user data, **RLS enabled on every table**.

### Identity & access

```sql
profiles (
  id uuid pk references auth.users on delete cascade,
  handle citext unique not null,          -- @handle, 3-24 [a-z0-9_.]
  display_name text not null,
  avatar_url text, bio text, country text,
  is_private boolean not null default false,
  created_at timestamptz
)
invites (
  code text pk,                           -- short human code
  created_by uuid references profiles,
  used_by uuid references profiles,       -- null until redeemed
  expires_at timestamptz
)
```

- Trigger `on auth.users insert` → create `profiles` row (handle placeholder until onboarding).
- Invite gate: an `is_invited(uid)` SQL function; a `redeem_invite(code)` RPC marks `used_by`.
  Profiles of un-invited users stay locked out by app routing **and** RLS on user-data tables.

### Metadata cache (TMDB mirror — public read, service-role write)

```sql
titles (
  id uuid pk, tmdb_id int unique not null,
  kind text not null check (kind in ('tv','movie')),   -- movie-ready, tv-only UI
  name text not null, overview text,
  poster_path text, backdrop_path text,
  first_air_date date, status text,        -- TMDB: Returning Series | Ended | Canceled | …
  genres text[] not null default '{}',
  network text,                            -- ORIGINAL broadcast network (US for most shows).
                                           -- Provenance only: drives the profile's top-networks
                                           -- stat, never "where do I watch this" — see providers.
  providers jsonb,                         -- TMDB watch/providers by ISO 3166-1 alpha-2 (0055):
                                           -- {"ES":[{"name","logo_path"}]}. Subscription-shaped
                                           -- only (flatrate/free/ads; rent/buy dropped at write
                                           -- time). Every country in one column — the API returns
                                           -- them all in one call, so changing the country setting
                                           -- needs no refetch. Absent country = not available
                                           -- there, and the UI shows no logo. Canonical extraction
                                           -- spec + tests: app/src/domain/watchProviders.ts.
  episode_run_time int, vote_average numeric, popularity numeric,
  imdb_rating numeric, imdb_votes int,     -- IMDb score, from IMDb's datasets (0057)
  aired_count int,                         -- authoritative aired regular-season episodes (0028)
  last_refreshed_at timestamptz
)
seasons (
  id uuid pk, title_id uuid fk, tmdb_id int,
  number int not null, name text, episode_count int, air_date date,
  unique (title_id, number)
)
episodes (
  id uuid pk, title_id uuid fk, season_id uuid fk, tmdb_id int,
  season_number int not null, episode_number int not null,
  name text, overview text, runtime int,
  air_datetime timestamptz,                -- UTC; client renders local
  tmdb_vote_average numeric, tmdb_vote_count int,  -- per-episode TMDB score (0057)
  imdb_rating numeric, imdb_votes int, imdb_id text, -- per-episode IMDb score (0057)
  unique (title_id, season_number, episode_number)
)
```

- RLS: `select` for authenticated; writes only via Edge Functions (service role).
- Season 0 (specials) is stored but **excluded from all derivations**.
- **IMDb ratings** (`imdb_rating` / `imdb_votes`, on both titles and episodes) are
  owned by ONE writer: the weekly GitHub Action `scripts/imdb-ratings`, which
  reads IMDb's own published datasets. Nothing else writes those columns.
  OMDb used to fill them nightly and was removed: it is both incomplete (it
  returns `"N/A"` for a large minority of episodes even asked directly, while
  reporting their vote count) and **stale** — it still serves Breaking Bad's
  "Ozymandias" as 10.0 from 251,146 votes where IMDb publishes 9.5 from 504,738,
  a snapshot from when that was true. Two writers on one column meant the nightly
  stale one kept overwriting the weekly fresh one.
  The importer only ever updates episode rows we already hold, and drops ratings
  too thinly voted (`MIN_VOTES`) or too freshly aired (`MIN_AGE_DAYS`) to have
  settled. Season aggregates are derived client-side (`app/src/domain/episodeRatings.ts`).
  The datasets are licensed for personal, non-commercial use.

### User data

```sql
library_entries (
  user_id uuid fk, title_id uuid fk,
  followed boolean not null default true,   -- the ONE watchlist bit (prototype's core model)
  favorite boolean not null default false,
  notify boolean not null default false,    -- "Notify me" on upcoming titles
  added_at timestamptz,
  primary key (user_id, title_id)
)
watch_events (
  id uuid pk, user_id uuid fk, episode_id uuid fk,
  watched_at timestamptz not null default now(),
  source text not null default 'app',       -- app | tvtime_import | seed
  unique (user_id, episode_id)              -- v1: no rewatches
)
ratings (
  id uuid pk, user_id uuid fk,
  title_id uuid fk null, episode_id uuid fk null,
  score int not null check (score between 1 and 10),
  created_at timestamptz, updated_at timestamptz,
  check (num_nonnulls(title_id, episode_id) = 1),
  unique (user_id, title_id), unique (user_id, episode_id)
)
```

RLS: owner-only (`user_id = auth.uid()`) for all CRUD, **plus** friend-read policies added in
Phase 4 (see Social).

### Social & system

```sql
friendships (
  a uuid fk, b uuid fk,                     -- canonical order: a < b
  requested_by uuid not null,
  status text not null check (status in ('pending','accepted')),
  created_at timestamptz, accepted_at timestamptz,
  primary key (a, b), check (a < b)
)
notifications (
  id uuid pk, user_id uuid fk,
  type text not null,                       -- new_episode | premiere | friend_request | import_done | reaction | …
  payload jsonb not null default '{}',
  read_at timestamptz, created_at timestamptz
)
activity_reactions (                        -- 0058: one emoji per person per feed row
  event_key text not null,                  -- minted by rpc_friend_activity: w:<actor>:<title>:<day>
  user_id uuid fk,                          --   (r:/a: for a rating / an add). The feed is a derived
  actor_id uuid fk,                         --   union, so the row's identity comes from the RPC, and
  title_id uuid fk,                         --   the day bucket is Europe/Madrid — never the viewer's
  emoji text not null,                      --   zone, or two friends would react to different rows.
  created_at timestamptz, updated_at timestamptz,
  primary key (user_id, event_key)
)
-- actor_id and title_id are DERIVED from event_key by a before-insert trigger and
-- never accepted from the client, and the write policy calls activity_event_exists()
-- to refuse a key that names no real rating/add/burst. Without both, a friend could
-- post a key naming a show you never watched and have the trigger deliver it to your
-- inbox. Writes also carry 0027's is_invited() gate, like every other user table.
notification_prefs (
  user_id uuid fk, type text,
  inapp boolean not null default true, email boolean not null default false,
  primary key (user_id, type)
)
import_jobs (
  id uuid pk, user_id uuid fk,
  kind text not null default 'tvtime_zip',
  status text not null check (status in ('pending','running','done','error')),
  report jsonb not null default '{}',       -- matched/unmatched counts, per-show results
  created_at timestamptz, finished_at timestamptz
)
```

Friend-read RLS (Phase 4): `library_entries`, `watch_events`, `ratings`, `profiles` gain a
`select` policy `is_friend(auth.uid(), user_id) and not profile_is_private(user_id)` via a
`security definer` helper. Aggregation RPCs (below) are `security invoker` so they respect it.

`activity_reactions` is gated by the **event**, not by the reactor: you read (and write) reactions
on rows that are yours or a friend's — and, as everywhere else, only while that friend is not
private. A reaction by someone you are not friends with is still visible to you, otherwise the
counts on a shared friend's row would lie; their name and face come from `rpc_event_reactions`
(`security definer`, same event gate), never from a widened read on `profiles`, and come back
**null** for a private reactor you have no claim on (rendered as "Someone").

## Core derivations (pure functions in `app/src/domain/`, unit-tested)

These reproduce the prototype's behavior. Prototype references are the spec.

### Show status (prototype: `Status` in `prototype/src/data.ts`)

Inputs: followed entry, aired-episode count `A`, watched count `W` (excluding specials),
title.status, first `air_datetime`.

```
not followed            → not in library (Explore pool)
A == 0 (nothing aired)  → upcoming
W == 0                  → watchlist
W <  A                  → watching
W == A && TMDB status in (Ended, Canceled) → finished
W == A                  → caughtup            (“waiting for more”)
```

### Up next (prototype: `Title.next`, Tonight tab in `prototype/src/marquee.tsx`)

For each `watching` show: the earliest aired, unwatched episode (season asc, episode asc).
"Fresh episodes" = up-next aired within the last 7 days. "Continue watching" = the rest,
ordered by most recently watched show first.

### Calendar feed (prototype: `episodeFeed` in `prototype/src/data.ts`, `MyShowsFeed` in `marquee.tsx`)

All episodes of followed shows with `air_datetime` in `[today - N weeks, today + 12 weeks]`,
grouped by local day: `Today / Tomorrow / <weekday>` for offsets 0..6, full date headers in the
past, single "Later" bucket beyond 6 days (with `in N days` + short date). Scroll up loads more
past weeks (N += 3, cap 60). Badges: **Season premiere** (`episode_number == 1`, or "Series
premiere" if also season 1) and **Season finale** (last episode of a season) — nothing else.
Views: `My shows` (the feed) / `Returning series` / `New & announced` (followed upcoming titles
split by whether TMDB says the title has a previous season; bucketed month / later / TBA).

### Match % (prototype: `FriendSheet` in `prototype/src/friends.tsx`)

`round(100 * |shared followed titles| / |friend's followed titles|)`.

## Data-access conventions (client)

The title/season-specific implementation and operational diagnostics are
documented in [DETAIL-PERFORMANCE.md](DETAIL-PERFORMANCE.md).

- One `lib/queryKeys.ts` — every TanStack Query key defined centrally, typed.
- Title and season query results are persisted selectively in IndexedDB (30-day
  retention, 24-hour freshness). Private/user-specific queries are never
  dehydrated. Hydration completes before React mounts, so a browser refresh can
  paint previously visited details immediately.
- Cached title/season metadata is read directly from the authenticated-readable
  Postgres tables. `tmdb-proxy` is the miss/revalidation path, not an extra hop
  on every warm read. Stale DB rows render immediately and revalidate in the
  background.
- Poster/search intent (brief hover, focus or pointer-down) prefetches the title,
  the server-derived continuation season, and that season's episodes. Query-key
  deduplication lets a click reuse work already in flight.
- `rpc_title_detail_progress()` chooses the continuation season and reduces
  unseen-prior counts in Postgres; the detail sheet does not download every
  episode of a long-running title merely to make those decisions.
- Mutations are **optimistic** with rollback (follow/unfollow, mark watched, rate) —
  match the prototype's instant feel.
- All supabase rows validated with Zod schemas in `lib/schemas.ts` before use.
- Server aggregates (stats, friend sections) are **Postgres RPCs**, not client math over big sets:
  `rpc_user_stats()`, `rpc_up_next()`, `rpc_calendar_feed(from,to)`, `rpc_popular_with_friends()`,
  `rpc_best_rated_by_friends()`, `rpc_friend_activity(limit)`, `rpc_event_reactions(keys[])`.
- Realtime: only the notifications inbox subscribes (Phase 3); everything else refetches. An
  *unread* reaction notification arriving is also what tells the feed its chips are stale —
  reactions themselves do not stream (0058). That subscription listens to INSERT/UPDATE/DELETE,
  which is why 0058 sets `replica identity full` on `notifications`: under the default identity a
  delete carries only the primary key, so the subscription's `user_id` filter could never match it
  and a withdrawn reaction's notification would linger on screen.

## TMDB integration

- Edge Function `tmdb-proxy`: `GET /search?q=`, `GET /title/:tmdbId` (details + seasons),
  `GET /title/:tmdbId/season/:n` (episodes). Each call **upserts** into cache tables, then
  returns the cached rows (client never sees raw TMDB payloads).
- `episode-refresh` scheduled function (daily): for every title referenced by any
  `library_entries.followed`, refresh future episodes + title status; upsert changes; enqueue
  `new_episode` notifications for `notify=true` followers (Phase 3 wires delivery).
- Network logos: static SVGs in `app/public/logos/` (already sourced in the prototype —
  Netflix/Apple/Disney official vectors, styled wordmark tiles for the rest).

## UI parity map (prototype file → production home)

| Prototype | Production |
|---|---|
| `src/index.css` tokens/glass/marquee CSS | `app/src/styles/*` (split, otherwise verbatim) |
| `src/components.tsx` (Poster, Stars, NetworkLogo, Rail…) | `app/src/ui/*` |
| `src/watchlist.tsx` context | TanStack Query + `library_entries` mutations |
| `src/marquee.tsx` shell/tabs/dock/palette | `app/src/features/*` + `ui/shell/` |
| `src/screens.tsx` DetailSheet | `app/src/features/detail/` |
| `src/friends.tsx` sheet + sections | `app/src/features/social/` |
| `src/data.ts` synthesized data | deleted — real data; its **logic** moves to `domain/` |
| `src/overlays.tsx` DesignLab | dropped; theme/accent settings only |
| `src/theme.tsx` | `app/src/lib/settings.ts` (localStorage-backed) |

## Commit conventions

- Conventional-commit style messages, exactly as listed in PLAN.md.
- No `Co-Authored-By` trailers, ever.
- Each commit: green `npm run check`, PLAN.md checkbox ticked, migrations additive-only.
