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
| Email | **Resend** from Edge Functions | The nightly `alerts` digest (new episodes), plus `friend-request-email`, which a database trigger fires through pg_net so the mail lands while the request is still news (0061). Magic links are Supabase-native. Every type with an Email chip in Settings has a producer here — that is what the chip means. |
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
│   ├── functions/          tmdb-proxy/, igdb-proxy/, episode-refresh/, alerts/,
│   │                       importer/, export/, friend-request-email/
│   └── seed/               dev fixtures
└── scripts/                offline tooling (tvtime-import/)
```

## Environment & secrets

- `app/.env.local` (gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Edge function secrets (`supabase secrets set`): `TMDB_API_KEY`, `RESEND_API_KEY`.
  `TMDB_API_KEY` holds a v4 read access token or a v3 key; `supabase/functions/_shared/tmdb.ts`
  is the only place either one touches a request, and the only place that decides
  whether it rides in a header or the query string. See DEPLOY.md.
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
  invited_at timestamptz,                 -- sealed on redemption; the invite pass
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
- Invite gate: `is_invited(uid)` reads `profiles.invited_at`, which `redeem_invite(code)` seals
  once (0062). The pass belongs to the person, not to the code: `invites.used_by` and
  `invite_redemptions` record which code was burned, but expiring, revoking or deleting a code
  never puts a redeemer back outside. A trigger keeps `invited_at` out of reach of the blanket
  UPDATE grant on `profiles`, so the gate can't be self-served.
  Profiles of un-invited users stay locked out by app routing **and** RLS on user-data tables.

### Metadata cache (TMDB + IGDB mirror — public read, service-role write)

```sql
titles (
  id uuid pk, tmdb_id int not null,        -- id en la fuente de SU medio: TMDB para tv/movie,
                                           -- IGDB para game. Unico solo junto a kind (0067/0071):
                                           -- /tv/1399 y /movie/1399 son cosas distintas.
  kind text not null check (kind in ('tv','movie','game')),
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
  original_name text,                      -- 0046: the localisation trio. name/overview stay in
  name_es text, overview_es text,          -- the app's base language; the _es pair is filled by
                                           -- the proxy when the language setting asks for it, and
                                           -- original_name is what the show is called at home —
                                           -- shown on the sheet, and searchable.
  imdb_id text, tvmaze_id int,             -- the two bridges out of TMDB: IMDb's datasets are
                                           -- keyed by imdb_id (0057), air TIMES come from TVmaze
                                           -- (tvmaze_id) because TMDB only dates an episode.
  air_time_source text not null            -- 'tvmaze' when the time is real, 'estimated' when it
    default 'estimated',                   -- was derived. The UI never presents a guess as a fact.
  release_dates jsonb,                     -- MOVIES (0068): {"ES": {"theatrical": …, "digital": …}}
                                           -- from /movie/:id?append_to_response=release_dates.
                                           -- Null on tv. Both dates alert, separately — 0072.
  collection_id int, collection_name text, -- MOVIES (0069): TMDB's belongs_to_collection, i.e. the
                                           -- saga. On a movie sheet it replaces the episode list.
  release_precision text,                  -- GAMES (0071): how much of first_air_date is real —
                                           -- day | month | q1..q4 | year | tbd. IGDB dates a
                                           -- "Q4 2027" with a precise timestamp, so without this
                                           -- the UI would promise a day nobody committed to.
                                           -- Null on tv and movie.
  platforms text[] not null default '{}',  -- GAMES: the catalogue filter ("only Switch").
  platform_releases jsonb,                 -- GAMES: a game ships five times, once per platform.
                                           -- first_air_date is still the one that sorts and dates;
                                           -- this is for the sheet ("on PS5 now, Switch in autumn").
  beat_seconds jsonb,                      -- GAMES: how long it takes to finish — the denominator
                                           -- for hours played. A catalogue fact, so it lives here.
  steam_appid int,                         -- GAMES (0071): the bridge to the Steam import (0076).
  episode_run_time int, vote_average numeric, popularity numeric,
                                           -- vote_average is 0-10 in all three media: IGDB scores
                                           -- out of 100 and the proxy divides before writing, so
                                           -- one rating UI serves tv, movie and game alike.
  imdb_rating numeric, imdb_votes int,     -- IMDb score, from IMDb's datasets (0057)
  aired_count int,                         -- authoritative aired regular-season episodes (0028)
  last_refreshed_at timestamptz,           -- the title row's DETAIL was refetched. Written by every
                                           -- full /tv/:id fetch, the discovery warm-up included.
                                           -- Gates /title's cache-first read, nothing else.
  rawg_id int,                             -- GAMES (0090): the matched RAWG game, kept so the
                                           -- name+platform+year search (the part that can be
                                           -- WRONG) runs once and not every month. Null with
                                           -- rawg_refreshed_at set = searched, no match.
  rawg_refreshed_at timestamptz,           -- GAMES (0090): RAWG was asked. Only scripts/rawg-metacritic
                                           -- writes it.
  metacritic_source text,                  -- GAMES (0090): 'steam' | 'rawg'. Two crons write the one
                                           -- metacritic column; this is what stops them wiping each
                                           -- other, and what tells the sheet when to credit RAWG.
  steam_notes_refreshed_at timestamptz,    -- GAMES (0089): Steam was ASKED for steam_reviews and
                                           -- metacritic. A third freshness mark, and deliberately
                                           -- not last_refreshed_at: only scripts/steam-notes (a
                                           -- GitHub Action — Steam answers 429 to Supabase's IPs)
                                           -- writes it, and gating the IGDB detail on it would
                                           -- freeze every sheet.
  episodes_refreshed_at timestamptz        -- the title's EPISODES were refetched (0066). Written
                                           -- only by episode-refresh and tmdb-proxy's whole-show
                                           -- fill. Gates /season's read and the nightly cron's
                                           -- staleness filter. Sharing one column for both facts
                                           -- let the 04:40 warm-up silence the 05:00 cron.
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
  air_date date,                           -- TMDB's bare day, the anchor (0060)
  air_datetime timestamptz,                -- UTC; client renders local
  tmdb_vote_average numeric, tmdb_vote_count int,  -- per-episode TMDB score (0057)
  imdb_rating numeric, imdb_votes int, imdb_id text, -- per-episode IMDb score (0057)
  unique (title_id, season_number, episode_number)
)
```

- RLS: `select` for authenticated; writes only via Edge Functions (service role).
- Season 0 (specials) is stored but **excluded from all derivations**.
- **Air times have two sources and one rule.** `air_date` is TMDB's day and is
  authoritative; `air_datetime` may be TVmaze's real `airstamp` (a printable
  clock — `air_time_source = 'tvmaze'`) or the 21:00 UTC placeholder over that
  same day (`'estimated'`, no clock shown). **TVmaze may set the hour, never the
  day.** The two catalogues do not number episodes identically — TMDB's Hot Ones
  season 30 is thirteen episodes and TVmaze's eleven — so pairing them on
  `season × number` alone dated a whole season off other episodes' broadcasts,
  which the alert window and the aired/up-next gates then acted on. The pairing
  matches TVmaze's local `airdate` against `air_date`, spec in
  `app/src/domain/airPairing.ts`, hand-mirrored into both ingest paths and held
  there by `airPairing.mirror.test.ts`.
- **IMDb ratings** (`imdb_rating` / `imdb_votes`, on both titles and episodes) are
  owned by ONE writer: the hourly GitHub Action `scripts/imdb-ratings`, which
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
- **What a show needs before it can be rated**, since both halves used to be
  filled for followed titles only — which is why a show nobody had added showed
  neither per-episode scores nor the season graph:
  1. `titles.imdb_id` — the only key the importer matches a title by. Written by
     any full title refresh (they all append `external_ids`), and backfilled
     across the whole cache — series **and cine** — by
     `episode-refresh?backfillImdbIds=1`, que desde 0080 corre **cada hora** por
     cron. En cine el repaso no es un extra: una peli entra en la caché desde
     Explorar y desde la búsqueda, y ninguna de las dos escribe `imdb_id`, así
     que sin esa pasada solo tendrían nota las películas que alguien ha abierto.
  2. `episodes` rows — the importer updates, never inserts. The first time anyone
     opens a show, `tmdb-proxy` ingests **every** regular season behind the
     response (`fillWholeShow`), so the next nightly run rates all of it rather
     than the one season that happened to be on screen.
  Both land before the 04:00 UTC import, so a show opened today is graphed
  tomorrow morning.

### User data

```sql
library_entries (
  user_id uuid fk, title_id uuid fk,
  followed boolean not null default true,   -- the ONE watchlist bit (prototype's core model)
  favorite boolean not null default false,
  notify boolean not null default false,    -- "Notify me" on upcoming titles
  stopped boolean not null default false,   -- dropped it without unfollowing. Kept apart from
                                            -- `followed` so the show stays in your history and
                                            -- your counts, and stops asking for your attention.
  added_at timestamptz,
  -- GAMES only. Null/zero on tv and movie; a game is one synthetic episode (0067/0071), so
  -- FINISHED is not here — that is the watch_event on it, same as everything else.
  play_state text,                          -- playing | ongoing | dropped (0073)
  minutes_played int not null default 0,    -- denominator lives in titles.beat_seconds
  minutes_source text,                      -- manual | steam (0073, meaningful since 0076)
  owned boolean not null default false,     -- you bought it. Orthogonal to play_state: written by
                                            -- the Steam import and by hand (console, GOG, physical)
  played_at timestamptz,                    -- when minutes_played/play_state last moved, set by the
                                            -- game_progress_touch trigger (0075). NOT "when you
                                            -- finished it". The Steam import seeds it from Steam's
                                            -- rtime_last_played so 41 games marked done at once do
                                            -- not all land on today's wall (0078).
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

### System, caches and the Steam bridge

None of these hold an opinion of yours — they are plumbing, receipts and warmed reads. They
are listed because "the schema is in ARCHITECTURE.md" has to stay true, and because two of
them (`job_runs`, `notifications_sent`) are the first place to look when something silently
stops happening.

```sql
job_runs (                                  -- 0029: one row per scheduled run, per exit path
  id uuid pk, job text not null,            -- episode-refresh | alerts | discover-warm |
                                            -- igdb-warm | steam-sync | imdb-dataset-import |
                                            -- steam-prices | steam-notes | rawg-metacritic (the
                                            -- last three run in
                                            -- GitHub Actions, not pg_cron: Steam blocks the
                                            -- edge functions' IPs — see DEPLOY)
  started_at timestamptz, finished_at timestamptz,
  ok boolean not null default false,
  summary jsonb not null default '{}'       -- the run's own report: counts, errors, skips
)
-- Including the boring zero-pending day and the error exits, ON PURPOSE: a missing recent row
-- always means the job did not complete, which is a thing you can query. `select job, ok,
-- started_at, summary from job_runs order by started_at desc` is the health check.

notifications_sent (                        -- 0012: the stamp book that makes alerts idempotent
  user_id uuid fk, episode_id uuid fk,
  event text not null default 'episode',    -- episode (tv) | theatrical | digital (movies, 0072)
  sent_at timestamptz,
  primary key (user_id, episode_id, event)
)
-- `event` joined the key in 0072 because a movie has ONE synthetic episode and TWO releases:
-- without it the second alert died as a duplicate of the first, silently — the worst ending,
-- since the system would report as sent something nobody received.

ignored_titles (user_id, title_id)          -- 0022: "stop suggesting this to me" in Explore
collections (…)                             -- 0020: curated lists, hand-built
collection_titles (collection_id, title_id) --   and their members
network_logos (…)                           -- 0023: logo paths per network, so the grid does not
                                            --   refetch TMDB for a picture that never changes
trending_cache (…)                          -- 0019 \  warmed by the daily crons, read by Explore.
popular_now_cache (…)                       -- 0025  }  Public read, service-role write, like the
discover_cache (…)                          -- 0064 /   rest of the metadata mirror.
```

The Steam import (0076/0078) is three tables because the flow is three steps — ask Steam, show
you what it found, then write only what you approved:

```sql
steam_link_nonces (                         -- the IOU of the OpenID round trip
  nonce text pk, user_id uuid fk,
  steam_id text,                            -- null until Steam confirms; set = verified, waiting
  created_at timestamptz, expires_at timestamptz default now() + interval '10 minutes'
)
-- RLS on and NO policy at all: only service_role, which bypasses it, ever touches this. It is
-- not your data, it is plumbing — and the return leg is a browser navigation that cannot carry
-- an Authorization header, which is why steam-sync is the one function deployed with
-- verify_jwt = false (see supabase/config.toml).

steam_imports (                             -- one per import attempt
  id uuid pk, user_id uuid fk,
  state text check (state in ('scanning','ready','applying','done','error')),
  error text,                               -- 'private' is the one the UI explains on its own
  started_at, finished_at timestamptz, summary jsonb
)
steam_import_items (                        -- one per game Steam returned
  id uuid pk, import_id uuid fk, user_id uuid fk,
  appid int not null, steam_name text not null,
  minutes int not null default 0,           -- MINUTES, Steam's own unit (playtime_forever) and
                                            -- the same one library_entries.minutes_played uses.
                                            -- There is no conversion anywhere in the path.
  title_id uuid fk null,                    -- null = not in the catalogue yet; ask IGDB by appid
  in_library boolean not null default false
)
```

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
  Manual modes: `?force=1` (ignore staleness), `?allSeasons=1` (whole show, not
  the latest two — backfills the per-episode TMDB score). Y `?backfillImdbIds=1`
  (resolve `titles.imdb_id` for tv + movie, in rounds until `remaining` is 0),
  que ya no es solo manual: tiene su propio cron horario (`imdb-id-backfill-hourly`)
  porque la cola del cine se rellena sola cada día y a mano no se vaciaba nunca.
- Network logos: static SVGs in `app/public/logos/` (already sourced in the prototype —
  Netflix/Apple/Disney official vectors, styled wordmark tiles for the rest).

## IGDB integration (videojuegos)

- TMDB no tiene juegos. La fuente es **IGDB**, que es de Twitch: la
  autenticación es *client credentials* con un Client ID y un Client Secret del
  PROYECTO (`IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`), no un login por usuario.
  Nadie ve nunca a Twitch. El token que devuelve dura ~60 dias y se cachea en el
  isolate.
- Edge Function `igdb-proxy`: `GET /search?q=`, `GET /game/:igdbId`. Escribe
  filas de `titles` con `kind='game'` y devuelve las cacheadas, igual que
  tmdb-proxy. La traduccion del payload vive en `normalize.ts`, con tests que
  corre el job `edge` de CI.
- **El limite son 4 req/s por Client ID, compartidas entre todos los usuarios**
  (en TMDB el limite es holgado y de facto por usuario). La caché de `titles`
  no es una optimizacion aqui: es la unica forma de servir a mas de cuatro
  personas a la vez.
- Un juego, como una pelicula, mantiene un episodio sintetico S1E1 (trigger
  `synthetic_episode_sync`, migracion 0071) para no ramificar las ~27 funciones
  que leen `watch_events`. Las cinco superficies de series que ese episodio
  podria contaminar —calendario, avisos por correo, historial, muro y
  estadisticas— ya filtran `t.kind = 'tv'` desde que el cine paso por ahi, asi
  que los juegos quedan fuera sin tocar nada.
- Fechas: IGDB devuelve un timestamp concreto incluso para un "Q4 2027", asi que
  `titles.release_precision` guarda cuanto de `first_air_date` es real
  (`day | month | q1..q4 | year | tbd`) y la fecha guardada es el ULTIMO dia del
  periodo anunciado — de los dos errores posibles, "todavia no" se corrige solo
  y "ya salio" manda a alguien a buscar algo que no existe.
- Imagenes: `images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg`, y
  `poster_path` guarda el hash pelado, no una ruta como en TMDB.

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
