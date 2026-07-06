# Phase 3 — Round out + onboard friends

Goal: the app can alert (in-app + email), friends can import their own TV Time history and
join via invites, and everyone can take their data out. Ends with real users besides the author.

Read first: ARCHITECTURE → Social & system tables, TMDB integration.

---

## P3-C1 `feat(notifications): in-app inbox + bell + read state`

**References**: `prototype/src/overlays.tsx` → `NotifPanel` (visual reference).

**Steps**
1. `useNotifications()` query + Realtime subscription on `notifications` (insert → prepend + bell dot).
2. Bell popover (port NotifPanel styling): rows with icon per type, relative time, unread dot;
   "Mark all read" (`update … set read_at`).
3. Row click routes by type (`new_episode` → detail sheet; `import_done` → import report).

**Acceptance criteria**: inserting a row via SQL pops the bell dot live; read state persists.

---

## P3-C2 `feat(edge): new-episode alert job → inbox rows + Resend email`

**Steps**
1. Function `alerts` (scheduled daily, after episode-refresh): for each episode that aired in the
   last 24h of a followed title (and premieres of `notify=true` titles) **not yet notified**
   (dedupe table `notifications_sent(user_id, episode_id) pk`), insert `notifications` row and,
   if `notification_prefs.email`, send via Resend (single digest email per user per run, not
   one per episode).
2. Migration `000N_notifications_sent.sql` for the dedupe table (service-role only).
3. Email template: plain, listing show / SxE / title — text-first, minimal HTML.

**Acceptance criteria**: seeded scenario produces exactly one inbox row + one digest email per
user across repeated runs (idempotent).

---

## P3-C3 `feat(notifications): preferences UI (per-type in-app/email toggles)`

**Steps**
1. Settings sheet → Notifications section: rows per type (`new_episode`, `premiere`,
   `friend_request`, `import_done`) with in-app / email toggles; upsert `notification_prefs`.
2. Defaults per ARCHITECTURE (in-app on, email off) materialized lazily (absent row = default).

**Acceptance criteria**: toggling email off suppresses the digest for that type (job respects prefs).

---

## P3-C4 `feat(import): in-app TV Time zip importer (upload → job → report)`

**References**: `scripts/tvtime-import/` (P0-C10 — reuse its parsing/mapping as a shared lib).

**Steps**
1. Extract the parsing + TVDB→TMDB mapping from the script into `scripts/tvtime-import/lib.ts`
   (runtime-neutral: no Node-only APIs in the shared part) and import it from an Edge Function
   `importer`.
2. Flow: Settings → "Import from TV Time" → upload zip to Storage bucket `imports` (owner-only) →
   insert `import_jobs(pending)` → invoke `importer` (unzips, parses, maps, writes user data with
   `source='tvtime_import'`, updates job to `done` with report jsonb) → notification `import_done`.
3. Import screen: drop zone, job status (poll query), report view (matched/unmatched with
   per-show rows, unmatched flagged for manual search-and-add).
4. Guardrails: job runs idempotently (unique watch_events absorb re-runs); 25MB zip cap;
   reject non-TV-Time zips with a clear error.

**Acceptance criteria**: importing the author's real zip through the UI reproduces the seeded
counts (±0); a second import of the same zip changes nothing.

---

## P3-C5 `feat(invites): create/share invite codes UI`

**Steps**
1. You → "Invites" card: list my codes + status (unused/used by @handle/expired), "Create invite"
   (insert with random readable code, 30-day expiry), copy-link button
   (`https://<domain>/login?invite=CODE` — prefills the gate after auth).
2. Cap: 10 unused codes per user (DB check constraint or policy-enforced count via RPC).

**Acceptance criteria**: full loop — create code, redeem in an incognito session, creator sees
"used by @handle".

---

## P3-C6 `feat(export): download-my-data (JSON + CSV)`

**Steps**
1. Edge function `export`: streams a zip with `library.json`, `watch_events.csv`, `ratings.csv`,
   `profile.json` for the calling user.
2. Settings → "Export my data" button.

**Acceptance criteria**: exported CSVs round-trip: counts match the DB; file opens in Numbers/Excel.
