# Phase 0 — Foundations

Goal: a repo where `app/` builds and tests green, Supabase runs locally with the **entire**
schema migrated, TMDB data flows through the proxy into the cache tables, and the author's
TV Time history is seeded. No product UI yet beyond the ported design system.

Read first: [ARCHITECTURE.md](../ARCHITECTURE.md) → Stack, Repo layout, Database schema.

Prereqs (human, one-time): Supabase account + project created; TMDB API key obtained;
Supabase CLI installed (`brew install supabase/tap/supabase`). Record project ref in
`supabase/.env.example` placeholders — never real values.

---

## P0-C1 `docs: add architecture and phase plans`

The commit that adds PLAN.md, docs/ARCHITECTURE.md, docs/phases/*, and updates DESIGN.md.
(Already specced by its own existence — tick it when these files land.)

---

## P0-C2 `chore: scaffold app/ workspace (Vite+React+TS+Router+Query+Zod, lint, vitest)`

**Steps**
1. `npm create vite@latest app -- --template react-ts` (**latest stable majors** across the board —
   decided over prototype-pinning; the frozen prototype keeps its own package.json).
2. Add deps: `react-router` (v7+ package name), `@tanstack/react-query`, `zod`, `@supabase/supabase-js`, `lucide-react`.
   Dev deps: `vitest`, `@testing-library/react`, `eslint` (+ typescript/react plugins), `prettier`, `tailwindcss` v4 + `@tailwindcss/vite` (CSS-first config — no tailwind.config.js/postcss).
3. `tsconfig`: `"strict": true`, path alias `@/* → src/*`.
4. Scripts in `app/package.json`: `dev`, `build`, `check` = `tsc --noEmit && eslint src && vitest run`.
5. Skeleton dirs per ARCHITECTURE repo layout (`lib/ domain/ ui/ features/ styles/`) with `.gitkeep` or placeholder index files.
6. `App.tsx`: render a single "Reel — scaffold OK" screen. `main.tsx`: QueryClientProvider + RouterProvider with one route.
7. One trivial vitest test (`domain/smoke.test.ts`) so the runner is proven.
8. Root `.gitignore` entries for `app/` artifacts; `app/.env.example` with the two VITE_ vars.

**Acceptance criteria**
- `cd app && npm run check` passes; `npm run dev` serves the placeholder screen.
- No secrets committed.

**Verification**: run the commands above; load the dev URL via preview tools.

---

## P0-C3 `feat(app): port design tokens, glass look and base UI kit from prototype`

**References**: `prototype/src/index.css`, `prototype/src/components.tsx`, `prototype/public/logos/`.

**Steps**
1. Split `prototype/src/index.css` into `app/src/styles/tokens.css` (`:root` + `data-theme`/`data-accent`/`data-radius`/`data-density` variables), `glass.css` (`[data-look="glass"]` rules — production hardcodes `data-look="glass"` on `<html>`), `marquee.css` (`.mq-*`, `.cal-*`, `.fr-*`, rails, sheets, badges, buttons, chips…). Drop `[data-look="fable"]`/`neo` and classic-shell-only rules (`.sidebar`, `.profile-cover` stays — used by You).
2. Copy `prototype/public/logos/*.svg` → `app/public/logos/`.
3. Port from `prototype/src/components.tsx` → `app/src/ui/`: `Poster`, `Stars`, `NetworkLogo`, `posterBg`, `Logo`. Types come from `app/src/domain/types.ts` — define a `TitleCard` view-model type (id, name, year, genres, network, posterPath?, voteAverage, progress?) instead of the prototype's `Title`; `Poster` renders `poster_path` images when present, falling back to the `posterBg` gradient.
4. Port `Rail` (edge-arrow carousel) from `prototype/src/marquee.tsx` into `app/src/ui/Rail.tsx`.
5. `app/src/lib/settings.ts`: theme/accent persisted to localStorage, applied to `<html>` dataset (port the effect from `prototype/src/theme.tsx`, dropping concept/look).
6. Demo route `/kit` rendering: a Poster grid from hardcoded fixtures, Stars, a Rail, buttons/chips/badges — for visual QA (kept permanently; it's the living style guide).

**Acceptance criteria**
- `/kit` visually matches the prototype's glass look (dark default, coral accent).
- Theme toggle light/dark works. `npm run check` green.

**Verification**: preview `/kit`; DOM-inspect one `.card` for `backdrop-filter` and token colors.

---

## P0-C4 `chore: init supabase project (config, local dev, env plumbing, CI)`

**Steps**
1. `supabase init` at repo root (creates `supabase/`). Commit `config.toml`.
2. `supabase/.env.example` documenting `TMDB_API_KEY`, `RESEND_API_KEY` (set via `supabase secrets set`, values never committed).
3. `app/src/lib/supabase.ts`: create client from `import.meta.env` vars; fail fast with a clear error if missing.
4. GitHub Actions workflow `.github/workflows/check.yml`: on push/PR → setup node → `cd app && npm ci && npm run check`.
5. README section in PLAN.md is enough — do not add a separate README.

**Acceptance criteria**: `supabase start` boots locally; `supabase db reset` runs (no migrations yet); CI file lints.

---

## P0-C5 `feat(db): profiles + invites schema, RLS, signup trigger`

**References**: ARCHITECTURE → Identity & access.

**Steps** (decisions from the P0-C5 grill folded in — deviations from the
original spec noted inline):
1. Migration `0001_profiles_invites.sql`: `citext` extension (in `extensions`
   schema); `profiles`, `invites` per ARCHITECTURE, plus a DB-level CHECK
   `handle ~ '^[a-z0-9_.]{3,24}$'` (defence in depth). RLS enable. Grants are
   **deterministic**: `revoke all … from anon, authenticated` then
   `grant`-specific, so the migration behaves the same regardless of the
   deprecated "auto-expose new tables" flag (removed 2026-10-30). Policies:
   - profiles: owner read + owner update; **no insert policy** (the trigger
     creates the row), no delete (cascades from `auth.users`). Friend/public
     read arrives Phase 4.
   - invites: `select` where `created_by = auth.uid() or used_by = auth.uid()`
     (⚠ tighter than the original `used_by is null or …`, which leaked all
     unused codes to every authenticated user); `insert` only when
     `created_by = auth.uid() AND is_invited(auth.uid())` (only invited users
     mint codes); redeem via RPC only (no update/delete grant).
2. Trigger function `handle_new_user()` security definer (`search_path=''`):
   inserts profile with `handle = 'user_' || left(replace(id::text,'-',''),16)`
   (16 hex → collision-proof, ≤24 chars; was `left(id::text,8)`),
   `display_name = coalesce(raw_user_meta_data->>'name', 'New user')`.
3. Functions (security definer, `search_path=''`): `is_invited(uid uuid)
   returns boolean` (exists in `invites.used_by`); `redeem_invite(p_code text)`
   RPC: **rejects if the caller is already invited** (one gate per user), then
   atomically claims an unused + unexpired code (single `update … where used_by
   is null` → second redemption is a no-match); raises on failure.
4. Seed file `supabase/seed/dev.sql`: 3 open invite codes for local dev
   (`config.toml` `[db.seed]` points at `./seed/dev.sql`).

**Acceptance criteria**: `supabase db reset` green; creating a user (auth admin
API) auto-creates a profile; redeeming a code twice fails; a second user cannot
redeem a used code; an already-invited user cannot redeem again; non-invited
users cannot mint codes; cross-user profile writes hit 0 rows; anon is blocked.

**Verification**: `supabase db reset`, then SQL in Studio: create test user via auth admin, check profile row, call `redeem_invite`.

---

## P0-C6 `feat(db): titles/seasons/episodes metadata cache schema + RLS`

Migration `0002_metadata.sql` per ARCHITECTURE → Metadata cache. Include:
- Indexes: `titles(tmdb_id)` and `episodes(title_id, season_number, episode_number)`
  are already provided by their UNIQUE constraints — not duplicated. Added:
  `episodes(title_id, air_datetime)` (calendar/up-next) and `episodes(season_id)`
  (unindexed FK → slow cascades + season joins).
- RLS: `select` to `authenticated`; no insert/update/delete policies. Grants are
  deterministic (`revoke all from anon, authenticated` → `grant select` to
  authenticated, `grant all` to `service_role`) so Edge-Function upserts work on
  local and hosted regardless of the "auto-expose new tables" flag.

**Acceptance criteria**: reset green; anon select blocked, authenticated select allowed (test with Studio's role impersonation).

---

## P0-C7 `feat(db): library_entries, watch_events, ratings schema + RLS`

Migration `0003_userdata.sql` per ARCHITECTURE → User data. Owner-only policies
(`using (user_id = auth.uid()) with check (user_id = auth.uid())`) for all four verbs.
Indexes: `watch_events(user_id, episode_id)`, `library_entries(user_id) where followed`,
`ratings(user_id, created_at desc)`.

**Acceptance criteria**: reset green; cross-user select returns 0 rows under impersonation.

---

## P0-C8 `feat(db): friendships, notifications, prefs, import_jobs schema + RLS`

Migration `0004_social_system.sql` per ARCHITECTURE → Social & system.
- Friendships policies: participants read; insert by `requested_by = auth.uid()` with status
  `pending`; update (accept) only by the *other* participant; delete by either.
- Helper `is_friend(u1 uuid, u2 uuid) returns boolean` security definer (accepted row, either order).
- Notifications/prefs/import_jobs: owner-only. Import jobs insert-own, update via service role.

**Acceptance criteria**: reset green; the friendship state machine enforced by policies
(A requests → B accepts; A cannot self-accept).

---

## P0-C9 `feat(edge): tmdb proxy function with metadata upsert + typed client`

**References**: ARCHITECTURE → TMDB integration.

**Steps**
1. Edge function `supabase/functions/tmdb-proxy/index.ts` (Deno): routes `search`, `title`, `season` per ARCHITECTURE. Auth: require a valid user JWT (reject anon). Uses `TMDB_API_KEY` secret + service-role client for upserts.
2. Upsert mapping TMDB → our columns (network = first network name; genres = names array; `air_datetime`: combine TMDB air_date with 21:00 **UTC placeholder** — refined later if we add a time source; document this in code).
3. Shared zod schemas for the function's responses in `app/src/lib/schemas.ts` (duplicated minimal types on the Deno side — no cross-runtime import gymnastics).
4. `app/src/lib/tmdb.ts`: typed fetch helpers `searchShows(q)`, `getTitle(tmdbId)`, `getSeason(tmdbId, n)` calling the function with the session token.
5. Unit tests for the response schemas against recorded fixture JSON (`app/src/lib/__fixtures__/`).

**Acceptance criteria**
- `supabase functions serve tmdb-proxy` + curl with a user JWT returns search results AND rows
  appear in `titles`.
- Client helpers typecheck; fixture tests pass.

---

## P0-C10 `feat(scripts): TV Time zip seed importer (author data, TVDB→TMDB)`

**References**: DESIGN.md → Source data reference. The zip stays outside the repo.

**Steps**
1. `scripts/tvtime-import/` (plain Node + TS, run with `tsx`): `index.ts <path-to-zip-dir> [--dry-run]`.
2. Parse: `followed_tv_show.csv` (follow set), `seen_episode_source.csv` + `show_seen_episode_latest.csv` (watch state: latest-seen implies all prior episodes seen — reconstruct via TMDB episode lists), the three ratings CSVs (union, dedupe: newest wins).
3. TVDB→TMDB mapping via TMDB `/find/{tvdb_id}?external_source=tvdb_id` (direct TMDB call here — offline script may hold the key via env var `TMDB_API_KEY`).
4. For each mapped show: upsert title/seasons/episodes (reuse the proxy's upsert SQL shape), insert `library_entries(followed)`, `watch_events(source='tvtime_import')`, `ratings`.
5. Write a report JSON (matched/unmatched shows, counts) to the export dir, print a summary table. `--dry-run` produces the report without writes.
6. Doc header in the script: how to run against local vs hosted Supabase (service-role key via env).

**Acceptance criteria**
- Dry run on the author's export reports ≥ 300 of 326 followed shows matched.
- Real run: `select count(*) from watch_events` in the ballpark of ~9k; spot-check 3 shows'
  watched state against TV Time.

**Verification**: run dry-run + real against local `supabase start`, paste the summary in the commit body.
