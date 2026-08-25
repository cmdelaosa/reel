# TV tracker — Design & Plan of Record

A personal TV-show and movie tracker to replace TV Time (which is shutting down), for
the author and later a small circle of friends. Web-first, with native iOS/Android to
follow. This document is the outcome of a structured design interview and is the
authoritative record of **product decisions**; update it as decisions change.

> **Execution:** the build itself is planned commit-by-commit in [docs/PLAN.md](docs/PLAN.md)
> (status table) + [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) + `docs/phases/PHASE-N.md`.
> The Roadmap section below is superseded by those files.

> **Scope has moved since this interview (August 2026).** Everything below still records what
> was decided *then*, and the "TV only, movies deferred" rows are the biggest thing time has
> undone: Reel now ships **three media** — TV, Movies and **videogames** — as modes sharing one
> library, one wall and one friends layer. `titles.kind` is `tv | movie | game`, games come from
> IGDB rather than TMDB, and a Steam importer fills a library the way the TV Time zip does.
> The rows are left standing rather than rewritten: this file is the record of a decision, and a
> decision quietly edited to match the present teaches nothing. What is authoritative *today*
> is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the migration headers.

## Product vision

- Track TV shows: what you're watching, what's next, what you've seen, and how you rated it.
  (Movies are the original long-term goal but are **deferred** — see scope below. The data model stays movie-ready.)
- Start **private** (author + invited friends), keep a clean path to a **small public** product later.
- The pitch to friends — themselves TV Time refugees — is "switch over and keep all your history",
  so **importing a TV Time GDPR export is a first-class feature**, not an afterthought.

## Decisions (locked)

| Area | Decision | Notes |
|---|---|---|
| Ambition | Private now → small-public later | Design clean, don't over-engineer |
| Metadata source | **TMDB** | Free, TV + movies. Remap TV Time's TVDB IDs → TMDB on import |
| Platform strategy | **Web app first (Vite + React, evolved from the prototype)**; native route decided in Phase 6 (Capacitor wrap vs Expo rebuild spike) | *Changed 2026-07:* the validated UI already exists in web React (glass look relies on CSS `backdrop-filter`, poor fit for RN); reuse beats the single-codebase promise while native is deferred anyway. Pure `domain/` logic layer keeps the Expo option open |
| Web vs native | **Ship web first**, native later (see above) | App-like product; add-to-home-screen in the meantime |
| Backend | **Supabase** (Postgres + Auth + Realtime + Storage) | Relational data; generous free tier |
| Social | **Light social** (friends + activity feed) | Modeled from day one, shipped Phase 4 of docs/PLAN.md. Full concept validated in the prototype: friend profiles (stats, match %, watching-now, follows, top ratings) + friend-powered Explore |
| Content scope | **TV shows only for now** | Movies **deferred** to a later phase; model kept movie-ready (movie = ~1-episode case) |
| Offline | **Online-first + optimistic UI** | TanStack Query; revisit true offline later |
| Auth | **Email magic link + Google** now; **Apple** at iOS publish | Apple required by App Store once Google login ships |
| Sign-up | **Invite-only** during private phase | Invite codes / email allowlist |
| Notifications | **Email + in-app bell (inbox) with per-type prefs** now; **real push with native** | iOS web push is unreliable; push waits for native |
| UI | CSS design tokens + Tailwind utilities, "familiar but yours" design | Keep TV Time's good UX patterns, own visual identity. **Shipping: "Aurora Glass" look on the "Marquee" shell** (top tabs, ⌘K palette, mobile dock) — chosen after prototyping both against Classic (sidebar). Classic shell + Design Lab remain prototype-only |
| Distribution | **Web URL first**; native later (route per Phase 6 spike) | Zero store cost/friction to start |
| Budget | **Free tiers + ~$12/yr domain** | Apple $99/yr + Google $25 deferred to native publish |
| TV Time import | **Your data via seed script day one**; **in-app zip importer before inviting friends** | Friends self-onboard from their own exports |
| FilmAffinity / IMDb | **Later-phase import spike** | FA has no API → scrape logged-in votes → fuzzy-match to TMDB. IMDb = clean CSV export. TV ratings first; movie ratings when movies land |

## Tech stack

- **Client:** Vite + React + TypeScript, React Router, TanStack Query, Zod; design tokens as CSS
  variables (glass look), Tailwind utilities. (Expo/NativeWind plan superseded — see Platform strategy.)
- **Backend:** Supabase — Postgres, Auth (magic link + Google OAuth), Row-Level Security, Edge Functions (scheduled jobs), Storage.
- **Metadata:** TMDB API (search, details, season/episode lists), with a local cache of the minimal fields we need.
- **Email:** a transactional provider (e.g. Resend) driven from a Supabase scheduled Edge Function.
- **Builds (later):** native route (Capacitor vs Expo) decided by Phase 6 spike; TestFlight + Play internal testing before store release.
- **Repo:** single repo — `app/` (web client), `supabase/` (migrations, edge functions, seed), `scripts/` (import/migration), `prototype/` (frozen design reference), `docs/` (plan).

## Data model (sketch — to be refined in Phase 0)

- `profiles` — extends `auth.users`: display name, avatar, privacy (public/private), bio, country.
- `titles` — TMDB cache: `type` (tv|movie), `tmdb_id`, name, poster, year, runtime, status.
- `seasons`, `episodes` — TV only: TMDB ids, numbers, air dates (cached on demand).
- `library_entries` — `(user_id, title_id, status: watching|watchlist|archived, is_favorite, followed, folder)`.
- `watch_events` — `(user_id, episode_id | movie title_id, watched_at, source)`; append-only history.
- `ratings` — `(user_id, target: episode|movie, score, created_at)`.
- `friendships` — `(user_id, friend_id, status)` for light social.
- `notifications` — in-app inbox rows; `notification_prefs` — per-type toggles.
- `invites` — `(code, created_by, used_by, expires_at)`.
- `import_jobs` — status/results of an in-app TV Time zip import.

Principle: **the user owns their data** — easy full export is a design goal (we are, after all, replacing a service that shut down).

## Roadmap

> **Superseded:** kept for historical context. The live plan is [docs/PLAN.md](docs/PLAN.md).

### Phase 0 — Foundations
Repo scaffold (Expo + NativeWind + TS + TanStack Query). Supabase project: schema + RLS +
auth (magic link + Google). TMDB integration layer with caching. Seed script that imports the
**author's** TV Time zip (TVDB→TMDB mapping, dedupe the three ratings schemas, reconstruct watch state).

### Phase 1 — Dogfood (just the author) — "lean core first"
Search TMDB → add show/movie → library grid → show/episode detail → mark watched (episode/season/movie,
optimistic) → up-next list → watchlist bucket → ratings. Deploy web build; invite-only auth.
**This is the milestone the author runs daily to validate the core loop.**

### Phase 2 — Round out + onboard friends
Stats dashboard, in-app notification bell (inbox), **in-app TV Time zip importer** (upload → TVDB→TMDB
match → report), email new-episode alerts via scheduled Supabase Edge Function, notification-preferences
UI, invite flow. → invite friends.

### Phase 3 — Light social + more imports
Friend activity feed ("friends watching X"), FilmAffinity import spike (scrape votes → TMDB match →
ratings), IMDb CSV import, richer stats.

### Phase 4 — Native + public
EAS builds, TestFlight/Play internal testing, Apple Sign-In, real push notifications, open sign-up
(and/or waitlist), data-export/GDPR features, basic moderation.

### Deferred — Movies
Add movie search/add/watched/rating (movie = the 1-episode case of the title model), plus movie
ratings in the FilmAffinity/IMDb import. Slots in once the TV core is proven — no rework expected
since the schema is kept movie-ready from the start.

## Open items (decide during build)

- ~~App name + domain~~ → **resolved (P1 grill)**: name stays **Reel**; private
  beta ships on a free `*.vercel.app` subdomain (exact URL fixed at first deploy —
  a custom domain later only adds an entry to the Supabase auth allowlist).
  *Since then:* the custom domain happened — the app lives at
  [reel-app.com](https://reel-app.com), hosted on Cloudflare Workers
  ([docs/MIGRATION-CLOUDFLARE.md](docs/MIGRATION-CLOUDFLARE.md)).
- Exact set of notification types and their default on/off.
- FilmAffinity scrape feasibility (auth, pagination, HTML stability) — validate in a Phase 3 spike.
- Whether a small folders/collections feature (TV Time "folders") is worth carrying over.

## Source data reference (author's TV Time GDPR export)

Highlights of what the export contains, for the importer:
- `user_tv_show_data.csv` (433 shows), `followed_tv_show.csv` (326), `show_seen_episode_latest.csv` (244),
  `seen_episode_source.csv` (375 episode-marked events), `show_addiction_score.csv`, `episode_emotion.csv`.
- Ratings split across **three schema generations**: `ratings-prod-episode_votes.csv`,
  `ratings-v2-prod-votes.csv`, `ratings-3-prod-episode_votes.csv` — union + dedupe on import.
- IDs are **TheTVDB** series IDs (e.g. Twin Peaks = 70533) → map to TMDB via TMDB's TVDB cross-reference.
- Lifetime stats: ~9,196 episodes watched, 829 shows followed (per `user_statistics.csv`).
- **Security note:** the raw export contained a live Facebook OAuth token and a bcrypt password hash —
  keep the zip out of the repo and off any shared storage; revoke TV Time's Facebook access.
