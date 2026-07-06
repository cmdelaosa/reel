# Phase 5 — Explore + polish

Goal: feature parity with the prototype everywhere else, production-grade resilience, and an
e2e safety net. After this phase the app is "done" for the private-friends era.

---

## P5-C1 `feat(explore): trending via TMDB, genre chips, discover grid with Add`

**References**: `prototype/src/marquee.tsx` → `Explore`.

**Steps**
1. `tmdb-proxy` route `trending` (TMDB `/trending/tv/week`, upserted + cached 24h in a
   `trending_cache` table or function-memory — pick table for simplicity).
2. Explore layout per prototype: search row (opens palette), genre chips, **Trending this week**
   rail with rank numbers (`mq-rank`, no network logos), then the social sections (Phase 4),
   collections (P5-C2), and **Not in your watchlist** discover grid.
3. Discover pool: trending + popular TMDB titles the user doesn't follow; genre chips filter it.
   Cards with outline **Add** button (accent **Added** once followed — keep card visible until
   navigation, matching prototype's chosen behavior).

**Acceptance criteria**: trending shows real TMDB data; Add follows + pulls metadata; genre
filter narrows the grid.

---

## P5-C2 `feat(explore): curated collections`

**Steps**
1. Table `collections(id, name, sub, hue, position)` + `collection_titles(collection_id,
   title_id, position)`; RLS read-all, service-role write. Seed 4 collections per prototype
   (Critically acclaimed / Bingeable in a weekend / Mind-benders / Award winners) with real titles.
2. Explore collection tiles (16:9 gradient cards) → collection screen (poster grid + Add buttons).

**Acceptance criteria**: tiles match prototype; collection screen lists seeded titles.

---

## P5-C3 `feat(ui): rails with edge arrows, network logos, empty states, skeletons`

**Steps**
1. Audit every horizontal scroller uses `Rail` (arrows appear only when scrollable, hidden on touch).
2. NetworkLogo coverage pass: verify the top ~20 networks in real data render acceptably
   (official SVGs for Netflix/Apple/Disney+ already; wordmark tiles for the rest; generic tile fallback).
3. Empty states for: empty library, empty calendar views, no ratings, no search results, no
   friends — short copy + a pointing CTA each.
4. Skeleton shimmer for: poster grids, detail sheet, calendar feed, You stats.

**Acceptance criteria**: throttled-network walkthrough shows skeletons not layout jumps; every
empty state reachable and sensible.

---

## P5-C4 `fix(ui): error boundaries, retry states, offline toast`

**Steps**
1. Route-level React error boundary with a glass "Something broke — retry" card.
2. TanStack Query: global retry/backoff tuning; per-query error UIs on the 5 primary screens.
3. `navigator.onLine` listener → offline toast; mutations queue-or-reject with clear messaging
   (reject is fine — online-first is the locked decision).

**Acceptance criteria**: killing the network mid-session degrades gracefully (no white screens);
supabase 500s render retry UIs.

---

## P5-C5 `feat(a11y): keyboard nav, focus traps in sheets, reduced-motion`

**Steps**
1. Sheets (detail/friend/confirm/palette/settings): focus trap, Esc close, focus restore,
   `role="dialog"` + labels.
2. Full keyboard pass: tabs, chips, episode checks, pager — operable and visibly focused
   (`:focus-visible` ring token).
3. `prefers-reduced-motion`: disable rise/fade animations.
4. Poster/interactive elements: accessible names (show title, action labels).

**Acceptance criteria**: keyboard-only session can complete the core loop; axe DevTools scan on
the 5 screens reports no serious violations.

---

## P5-C6 `test(e2e): playwright smoke — login, add show, mark watched, calendar`

**Steps**
1. Playwright setup in `app/` (`npm run test:e2e`), running against local Vite + local Supabase
   with a seeded test user (magic-link bypass: `supabase.auth.signInWithPassword` on a
   password-enabled test user — enable email/password for the local env only).
2. One smoke spec: login → search "Severance" → add → open detail → mark 2 episodes (one via
   mark-up-to-here confirm) → Tonight shows correct up-next → Calendar shows the feed →
   rate the show → rating listed in You.
3. CI job (separate workflow, `workflow_dispatch` + nightly — not per-push; it needs supabase).

**Acceptance criteria**: spec green locally twice in a row (no flake); documented one-command
runner `npm run test:e2e`.

Tag `v0.5.0` — feature-complete vs prototype.
