# Plex auto-tracking — webhook + weekly reconciliation

Plan agreed 2026-07-10. Two layers: a real-time **webhook** (layer 1) marks episodes watched as
they finish playing in Plex, and a **weekly poll** (layer 2) reads Plex watch history to fill any
events the webhook missed. Plex is the source of truth: unknown shows get auto-followed.

## Decisions (interview log)

| Question | Decision |
| --- | --- |
| Viewing source | Almost everything plays through Plex (Plex Pass lifetime) → webhook covers ~100% |
| Mechanism | Webhook push (real time), `media.scrobble` event (~90% viewed) |
| Unknown shows | Auto-add (`library_entries.followed = true`) + mark watched. Plex = source of truth |
| Gaps | Mark only the reported episode; weekly poll is the safety net (no mark-up-to inference) |
| Scope | Regular TV episodes only — ignore movies and specials (season 0) |
| Poll auth | Plex OAuth PIN flow from Settings; account token stored server-side, revocable from plex.tv |
| Server reachability | Remote access is enabled → cloud functions reach the server via the plex.tv-discovered URI |
| Poll window | Since last successful run minus ~2 days overlap; first run ~9 days back. No full backfill |

## Architecture

```
                    ┌── layer 1 (real time) ──────────────────────────┐
Plex Media Server ──│ POST multipart webhook ──▶ edge fn plex-webhook │──▶ Supabase
   (Plex Pass)      └─────────────────────────────────────────────────┘   (service-role,
                    ┌── layer 2 (weekly safety net) ──────────────────┐     bypasses RLS)
pg_cron weekly ─────│ edge fn plex-poll ──▶ GET <server>/status/      │──▶ same writes,
                    │   sessions/history/all (account token)          │    idempotent
                    └─────────────────────────────────────────────────┘
```

Both layers converge on a shared resolver (`_shared/plex-resolver.ts`) that maps a Plex
episode reference → `titles`/`episodes` rows, then performs the same idempotent writes:

1. Upsert `library_entries (user_id, title_id, followed = true)` — on conflict do nothing
   (never flips an existing row's flags).
2. Insert `watch_events (user_id, episode_id, source = 'plex')` — on conflict
   (`user_id, episode_id`) do nothing. `source` is free text; `'plex'` is a new value, no
   constraint change needed.

Idempotency makes webhook/poll overlap and poll-window overlap harmless, and preserves the
v1 no-rewatch semantics (a rewatch scrobble is a no-op).

## Layer 1 — webhook (`supabase/functions/plex-webhook/`)

Plex → Settings → Webhooks → add `https://<project>.functions.supabase.co/plex-webhook?token=<secret>`.

- **Auth**: the `token` query param both authenticates and identifies the user. Store only a
  hash (`plex_links.webhook_token_hash`); compare in constant time. Rotate on disconnect.
- **Parsing**: Plex posts `multipart/form-data` with a `payload` field (JSON) and sometimes a
  thumbnail file — parse the `payload` part only.
- **Filters** (drop silently, return 200):
  - `event === 'media.scrobble'` only
  - `Metadata.type === 'episode'` only (no movies)
  - `Metadata.parentIndex >= 1` (no season-0 specials)
  - `Account.id` must match `plex_links.plex_account_id` (set on first event if null) — keeps
    other users on the same server from polluting the data.
- **Resolution**: shared resolver (below), then the two idempotent writes.
- Respond 200 fast; update `plex_links.last_event_at`. **Plex does not retry failed webhook
  deliveries** — that fire-and-forget behavior is exactly why layer 2 exists.

## Layer 2 — OAuth link + weekly poll

### Linking (`supabase/functions/plex-auth/`)

Plex OAuth PIN flow, driven from Settings:

1. `start`: create a PIN via `POST plex.tv/api/v2/pins` (`strong=true`, fixed
   `X-Plex-Client-Identifier` + product name), return the `plex.tv/link`-style auth URL and pin id.
2. Client opens the auth URL; user approves on plex.tv.
3. `complete`: poll `GET plex.tv/api/v2/pins/{id}` until it carries `authToken`; then call
   `GET plex.tv/api/v2/resources?includeHttps=1&includeRelay=1` with it, pick the owned server
   (PMS product), prefer a public/relay connection URI (remote access is on), and store
   token + URI + `plex_account_id` in `plex_links`.

The account token is stored in a **service-role-only column** — column privileges revoked from
`authenticated`, never selected by any client-facing query. (Supabase Vault is an optional
hardening step later.)

### Poll (`supabase/functions/plex-poll/`)

Scheduled weekly via **pg_cron + pg_net**, same pattern as `episode-refresh` (see its header
comment); also invocable on demand from Settings ("Sync now").

Per linked user:

1. Window: `since = last_poll_at - 2 days`, first run `now() - 9 days`.
2. `GET <server_uri>/status/sessions/history/all?viewedAt>=<epoch>&accountID=<plex_account_id>`
   with the account token. If the cached URI fails, re-discover via `plex.tv/api/v2/resources`
   and update `server_uri`.
3. Filter rows the same way as the webhook (episodes only, season >= 1).
4. History rows carry titles/indices but often **no external GUIDs** — fetch
   `GET <server_uri>/library/metadata/{ratingKey}` to get `Guid[]`. If the item was deleted
   from the library since, fall back to title-based resolution from the history row itself
   (`grandparentTitle`, `parentIndex`, `index`).
5. Resolve + idempotent writes; count inserts; set `last_poll_at = now()` only on success
   (a failed run keeps the window open for the next attempt).

## Shared resolver (`supabase/functions/_shared/plex-resolver.ts`)

Input: episode external GUIDs (`tmdb://`, `tvdb://`, `imdb://`), show title/year, season
number, episode number. Layered resolution, cheapest first:

1. **Cache hit by episode GUID**: a `tmdb://<id>` episode GUID matches `episodes.tmdb_id`
   directly → done. (TMDB `/find` does **not** accept TMDB ids, so tmdb GUIDs are cache-only.)
2. **TMDB `/find`** with `imdb://` or `tvdb://` episode GUID (`external_source=imdb_id|tvdb_id`)
   → `tv_episode_results[0]` gives `show_id` + season/episode numbers.
3. **Name fallback**: TMDB `/search/tv` with `grandparentTitle` (+ year if present) → best match
   show id. Least reliable; log these for review.

With a show `tmdb_id` in hand: if the title isn't cached yet, fetch + upsert title/seasons/
episodes reusing the `refreshTitle` logic from `episode-refresh` (extract it into `_shared/` or
mirror it), including its TMDB throttle. Then locate the episode row by
`(title_id, season_number, episode_number)`. Unresolvable events are logged and dropped —
never guess.

**Requirement**: the Plex library should use the new agent (Plex TV Series / TMDB) so events
carry external GUIDs; legacy-agent items degrade to the name fallback.

## Schema — `supabase/migrations/0024_plex_links.sql`

```sql
create table public.plex_links (
  user_id            uuid primary key references public.profiles on delete cascade,
  webhook_token_hash text unique,          -- layer 1 auth (hash only)
  plex_account_id    text,                 -- Plex Account.id, set on link or first event
  account_token      text,                 -- layer 2; service-role-only column (revoked from authenticated)
  server_uri         text,                 -- discovered PMS base URI (cached, re-discoverable)
  linked_at          timestamptz not null default now(),
  last_event_at      timestamptz,          -- last webhook accepted
  last_poll_at       timestamptz           -- last successful reconciliation
);
```

RLS: owner can `select` their own row (status display) — but **column grants exclude
`account_token`** (and ideally `webhook_token_hash`). All writes via service-role only.
Weekly job: `cron.schedule('plex-poll-weekly', ...)` calling the function through pg_net,
same as the documented `episode-refresh` scheduling.

## Frontend — Settings → "Connect Plex"

- **Connect** button → OAuth PIN flow (`plex-auth start/complete`).
- Webhook URL with token, copy button, and one-line setup instructions
  (Plex → Settings → Webhooks → Add).
- Status: linked account, `last_event_at`, `last_poll_at`.
- **Sync now** → invokes `plex-poll` for this user.
- **Disconnect** → rotates/deletes token hash, deletes account token, clears link row.

## Build order

1. **Backend core**: migration 0024 + `_shared/plex-resolver.ts` + `plex-webhook`.
   Testable immediately by pasting the URL into Plex.
2. **OAuth + Settings UI**: `plex-auth` + the Settings section (connect/status/disconnect).
3. **Reconciliation**: `plex-poll` + pg_cron weekly job + "Sync now" button.

## Open points (confirm during implementation)

- **Ignored titles** (migration 0022): recommendation — respect the ignore; neither webhook nor
  poll re-follows an ignored show (still record the watch event? default: skip entirely).
- Auto-added shows enter as plain `followed = true`; revisit if a distinct "auto-added" state
  is ever wanted.
- pg_cron + pg_net must be enabled on the hosted project (episode-refresh already assumes this).
- Poll pagination: history responses are paged (`X-Plex-Container-Start/Size`) — handle >1 page.
