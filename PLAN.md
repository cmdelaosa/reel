# Build plan — prototype → production

This is the **master execution plan** to take the validated prototype (`prototype/`) to a
production app with a real backend and full functionality. It is written to be executed
**commit by commit, in order, by a coding agent** — each commit is specified in a phase file
under `docs/phases/` with steps, acceptance criteria, and verification.

Companion docs:

- [DESIGN.md](DESIGN.md) — product vision + locked decisions (updated, still authoritative for *what*).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, repo layout, full DB schema, RLS, derivations, conventions (authoritative for *how*).
- [docs/DETAIL-PERFORMANCE.md](docs/DETAIL-PERFORMANCE.md) — durable metadata cache, title/season hot paths, prefetch, stable transitions, diagnostics, and rollout notes.
- `docs/phases/PHASE-N.md` — the commit specs (authoritative for *do this next*).

## How to execute this plan (instructions for the agent)

1. Find the **first unchecked commit** in the status table below.
2. Open its phase file and read **that commit's spec only** (plus the phase preamble).
3. Read the ARCHITECTURE.md sections the spec links to, and any prototype files it references.
4. Implement exactly what the spec says. **Do not** pull work forward from later commits,
   "improve" things not asked for, or change schema/API decisions — if a spec seems wrong or
   impossible, stop and ask the user instead of improvising.
5. Verify using the spec's *Verification* block (typecheck, tests, manual preview checks).
6. Make **one git commit** with the message given in the spec, and in the same commit tick the
   checkbox in the status table below.
7. Stop after the commit unless told to continue (batching a few commits per session is fine
   when the user says so).

Conventions (see ARCHITECTURE.md for the full list):

- TypeScript strict everywhere; Zod-validate everything that crosses a boundary.
- Never commit secrets. TMDB/Resend keys live only in Supabase function secrets.
- `npm run check` (typecheck + lint + unit tests) must pass on every commit.
- The prototype at `prototype/` is a **frozen reference** — read it, never edit it.
- UI parity: when a spec says "port X from the prototype", match its behavior and look
  (Marquee shell + glass look, CSS variables and all).

## Local development

Prerequisites: Node 22+, Docker (running), and the Supabase CLI
(`brew install supabase/tap/supabase`).

**Web app** (`app/`):

```bash
cd app
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # dev server
npm run check                # tsc --noEmit && eslint src && vitest run (CI gate)
```

**Supabase** (repo root):

```bash
supabase start               # boots the local stack in Docker
supabase db reset            # re-applies migrations + seed from scratch
supabase stop                # tears the stack down
```

Edge-function secrets (TMDB/Resend) are never committed: copy
`supabase/.env.example` → `supabase/.env` for local function serving, or
`supabase secrets set …` for the hosted project. CI (`.github/workflows/check.yml`)
runs `npm run check` in `app/` on every push and PR.

## Phases at a glance

| Phase | Outcome | Milestone |
|---|---|---|
| 0 | Repo scaffold, Supabase project, full schema + RLS, TMDB proxy, author-data seed | `npm run check` green; seeded DB browsable in Studio |
| 1 | Auth (magic link + Google, invite-gated), app shell, onboarding | You can log in on a deployed URL |
| 2 | Core loop: search → add → episodes → watched → up next → calendar → ratings → stats | **Dogfood**: author uses it daily instead of TV Time |
| 3 | Notification inbox + email alerts, in-app TV Time importer, invites, data export | Friends can self-onboard |
| 4 | Social: friendships, friend profiles, friend-powered Explore, activity feed | Prototype's friends layer, live |
| 5 | Explore/polish: trending, collections, a11y, skeletons, error states, e2e smoke | Feature-complete vs prototype |
| 6 | Native + public (outline only — spec when we get there) | Store builds, open sign-up |

## Status — every planned commit

Tick a box **in the same commit** that completes it.

### Phase 0 — Foundations ([docs/phases/PHASE-0.md](docs/phases/PHASE-0.md))

- [x] **P0-C1** `docs: add architecture and phase plans` (this commit)
- [x] **P0-C2** `chore: scaffold app/ workspace (Vite+React+TS+Router+Query+Zod, lint, vitest)`
- [x] **P0-C3** `feat(app): port design tokens, glass look and base UI kit from prototype`
- [x] **P0-C4** `chore: init supabase project (config, local dev, env plumbing, CI)`
- [x] **P0-C5** `feat(db): profiles + invites schema, RLS, signup trigger`
- [x] **P0-C6** `feat(db): titles/seasons/episodes metadata cache schema + RLS`
- [x] **P0-C7** `feat(db): library_entries, watch_events, ratings schema + RLS`
- [x] **P0-C8** `feat(db): friendships, notifications, prefs, import_jobs schema + RLS`
- [x] **P0-C9** `feat(edge): tmdb proxy function with metadata upsert + typed client`
- [x] **P0-C10** `feat(scripts): TV Time zip seed importer (author data, TVDB→TMDB)`

### Phase 1 — Auth + shell ([docs/phases/PHASE-1.md](docs/phases/PHASE-1.md))

- [x] **P1-C1** `feat(auth): supabase auth client, session store, magic-link + Google sign-in screen`
- [x] **P1-C2** `feat(auth): invite-code gate on first sign-in`
- [x] **P1-C3** `feat(app): marquee shell — top tabs, routes, mobile dock, settings sheet`
- [x] **P1-C4** `feat(app): onboarding — display name, handle, avatar upload`
- [ ] **P1-C5** `chore: deploy web app (Vercel) + auth redirect config` → **login on prod URL** — full runbook: [docs/DEPLOY.md](docs/DEPLOY.md) (Supabase link/push, functions, secrets, SMTP, cron scheduling)

### Phase 2 — Core library loop ([docs/phases/PHASE-2.md](docs/phases/PHASE-2.md))

- [x] **P2-C1** `feat(search): ⌘K palette searching TMDB via edge proxy`
- [x] **P2-C2** `feat(library): follow/unfollow (Add) + watchlist model + Shows grid with status buckets`
- [x] **P2-C3** `feat(detail): show detail sheet — TMDB data, seasons/episodes, both ratings`
- [x] **P2-C4** `feat(watch): mark episode watched (optimistic), mark-up-to-here confirm, undo`
- [x] **P2-C5** `feat(ratings): rate shows; ratings list in You (sort + 15/page)`
- [x] **P2-C6** `feat(upnext): up-next derivation + Tonight tab (fresh episodes, premieres, continue rail)`
- [x] **P2-C7** `feat(calendar): chronological my-shows feed with lazy history + returning/new views`
- [x] **P2-C8** `feat(edge): scheduled episode-refresh job (air dates, new seasons)`
- [x] **P2-C9** `feat(you): profile stats (episodes, time, shows, coming soon, avg rating)`
- [x] **P2-C10** `feat(notify): per-title "Notify me" flag` → **Dogfood milestone**

### Phase 3 — Round out + onboard friends ([docs/phases/PHASE-3.md](docs/phases/PHASE-3.md))

- [x] **P3-C1** `feat(notifications): in-app inbox + bell + read state`
- [ ] **P3-C2** `feat(edge): new-episode alert job → inbox rows + Resend email`
- [x] **P3-C3** `feat(notifications): preferences UI (per-type in-app/email toggles)`
- [x] **P3-C4** `feat(import): in-app TV Time zip importer (upload → job → report)`
- [x] **P3-C5** `feat(invites): create/share invite codes UI`
- [x] **P3-C6** `feat(export): download-my-data (JSON + CSV)`

### Phase 4 — Social ([docs/phases/PHASE-4.md](docs/phases/PHASE-4.md))

- [x] **P4-C1** `feat(social): friendships — request, accept, remove; friends section in You`
- [x] **P4-C2** `feat(social): friend profile sheet (stats, match %, watching now, follows, top ratings)`
- [x] **P4-C3** `feat(social): explore sections — popular with friends, best rated by friends (RPCs)`
- [x] **P4-C4** `feat(social): activity feed (rated/finished/added/started) in Explore`

### Phase 5 — Explore + polish ([docs/phases/PHASE-5.md](docs/phases/PHASE-5.md))

- [x] **P5-C1** `feat(explore): trending via TMDB, genre chips, discover grid with Add`
- [x] **P5-C2** `feat(explore): curated collections`
- [x] **P5-C3** `feat(ui): rails with edge arrows, network logos, empty states, skeletons`
- [x] **P5-C4** `fix(ui): error boundaries, retry states, offline toast`
- [x] **P5-C5** `feat(a11y): keyboard nav, focus traps in sheets, reduced-motion`
- [x] **P5-C6** `test(e2e): playwright smoke — login, add show, mark watched, calendar`

### Phase 6 — Native + public ([docs/phases/PHASE-6.md](docs/phases/PHASE-6.md))

Outline only — see the phase file. Specced when Phase 5 ships.

## Scope guardrails

- **Movies stay deferred** (schema is movie-ready; no movie UI).
- **No rewatch tracking** in v1 (`watch_events` unique per user+episode; column reserved).
- **Episode-level ratings** exist in schema; UI ships show-level only until after Phase 5.
- The classic (sidebar) shell and the Design Lab are **prototype-only** — production ships the
  Marquee shell with the glass look, plus theme (system/dark/OLED/light), accent and density
  in Settings (P1 grill decision; radius stays prototype-only).
