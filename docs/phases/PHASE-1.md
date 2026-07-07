# Phase 1 — Auth + shell

Goal: sign in with magic link or Google on a **deployed URL**, gated by invite codes, landing
in the Marquee shell with working navigation, theme settings, and a completed profile.

Read first: ARCHITECTURE → Identity & access, UI parity map.
Prototype references: `prototype/src/marquee.tsx` (shell), `prototype/src/theme.tsx`.

---

## P1-C1 `feat(auth): supabase auth client, session store, magic-link + Google sign-in screen`

**Steps**
1. `app/src/features/auth/`: `AuthProvider` exposing `session`, `profile` (query), `signOut`.
   Subscribe to `onAuthStateChange`; TanStack Query cache reset on sign-out.
2. Routes: `/login` (public) — glass card, email field → `signInWithOtp`, divider, Google button
   → `signInWithOAuth`. Confirmation state ("Check your inbox"). Errors inline.
3. Route guard: everything except `/login` requires a session (redirect keeps `from` location).
4. Local dev: magic-link emails never leave the machine — they land in the local
   mail catcher (Mailpit, formerly Inbucket) at the `MAILPIT_URL`/`INBUCKET_URL`
   printed by `supabase status` (default http://127.0.0.1:54324). Open the
   message and click the link, or grab it via the API:
   `curl -s http://127.0.0.1:54324/api/v1/messages`. The app dev server must run
   on an allow-listed port (4321, or 4322 via the `app-auth` launch config) so
   the link can redirect back — see `[auth] additional_redirect_urls` in
   `supabase/config.toml`.
5. Enable Google provider in Supabase dashboard (human step — leave a `TODO(human)` checklist in the commit body).

**Acceptance criteria**: full magic-link roundtrip works locally (Inbucket); Google works once
dashboard creds exist; refreshing keeps the session; sign-out returns to `/login`.

---

## P1-C2 `feat(auth): invite-code gate on first sign-in`

**Steps**
1. After auth, if `!is_invited(uid)` (expose as RPC `rpc_am_i_invited()` or select on invites),
   route to `/invite` — single code input calling `redeem_invite`.
2. On success → onboarding (P1-C4 route; placeholder until then). On failure → inline error.
3. The gate is advisory UX; RLS remains the real wall (user data policies already require rows
   they can only create through the app).

**Acceptance criteria**: fresh user hits `/invite`; bad code errors; good code proceeds; second
sign-in skips the gate.

---

## P1-C3 `feat(app): marquee shell — top tabs, routes, mobile dock, settings sheet`

**References**: `prototype/src/marquee.tsx` lines 1–115 (shell), `overlays.tsx` (DesignLab → reduced to settings).

**Steps**
1. `app/src/ui/shell/`: top bar (brand, tab nav, search button, bell placeholder, settings button,
   avatar → You), mobile dock — port markup/classes verbatim from the prototype.
2. Routes: `/tonight` (default redirect from `/`), `/shows`, `/explore`, `/calendar`, `/you`,
   each rendering a titled placeholder screen. Active tab from route.
3. Settings sheet (port DesignLab, stripped): theme light/dark/system, accent swatches, density.
   Persist via `lib/settings.ts`.
4. ⌘K opens an empty palette shell (search wiring lands P2-C1).

**Acceptance criteria**: tab + dock navigation matches prototype look/behavior; settings persist
across reload; deep-linking `/calendar` works.

---

## P1-C4 `feat(app): onboarding — display name, handle, avatar upload`

**Steps**
1. Route `/welcome` (forced when `profiles.handle` still has the `user_` placeholder):
   display name, handle (zod: `^[a-z0-9_.]{3,24}$`, uniqueness check on blur), optional avatar.
2. Avatar: Supabase Storage bucket `avatars` (public read, owner write — add migration
   `0005_storage_avatars.sql` with storage policies), client-side square crop + resize to 256px.
3. Update profile row; invalidate profile query; route to `/tonight`.

**Acceptance criteria**: new user must complete onboarding exactly once; avatar shows in the top
bar; taken handle rejected inline.

---

## P1-C5 `chore: deploy web app (Vercel) + auth redirect config`

**Steps**
1. Vercel project → `app/` root, SPA rewrite (`vercel.json`), env vars set (human: dashboard).
2. Supabase auth: site URL + redirect allowlist for the prod domain and localhost.
3. Smoke-test magic link + Google on prod. Document the URLs in DESIGN.md → Open items (name/domain now resolved — update the table).

**Acceptance criteria / milestone**: the author signs in on the production URL and sees the shell.
