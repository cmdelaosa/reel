# Title detail performance and season transitions

This document records the title-detail performance work shipped on 2026-07-12/13.
It complements [ARCHITECTURE.md](ARCHITECTURE.md), which remains authoritative
for the overall system design.

## Problem and target behavior

Opening an unseen title or season used to take several seconds. Revisiting it
was fast only until the page refreshed because TanStack Query lived in memory.
The detail sheet also made several serial requests before it could choose a
season, and changing seasons temporarily removed the episode list.

The intended behavior is now:

- revisited titles and seasons render immediately after a refresh;
- a warm server cache does not traverse an Edge function;
- a real TMDB miss is prefetched from clear user intent where possible;
- the detail sheet remains visually stable while data changes;
- private watch/rating/profile data is never persisted in the metadata cache.

## Read path and cache layers

Title metadata follows this order:

1. TanStack Query memory cache;
2. the selective IndexedDB snapshot;
3. direct authenticated reads from `titles` + `seasons` in Postgres;
4. `tmdb-proxy` on a cache miss or as background revalidation;
5. TMDB only when the server metadata cache has never been populated.

Season metadata follows the equivalent path through `seasons` + `episodes`.
The direct PostgREST reads use embedded relationships, so each warm lookup is a
single request rather than separate title/season/episode reads.

Metadata queries use a 24-hour `staleTime`, a 30-day `gcTime`, and a 30-day
IndexedDB snapshot lifetime. A stale database row is rendered immediately and
revalidated in the background. `last_refreshed_at` is included in the title
schema for this decision while remaining optional for old persisted snapshots
and partial search rows.

## Durable client cache

`app/src/lib/queryPersistence.ts` hydrates the IndexedDB snapshot before React
mounts and subscribes to query-cache changes with a short write debounce. Only
query keys beginning with `title` or `season` are dehydrated. Authentication,
profiles, ratings, watch history, and the watched-episode `Map` stay memory-only.

Storage denial and private-browsing failures are deliberately non-fatal: the
app falls back to the normal in-memory QueryClient.

## Intent prefetch

Poster and search-result intent handlers warm data after a 120-150 ms hover,
immediately on keyboard focus or pointer-down, and again (deduplicated) when the
title is opened. The prefetch chain loads:

1. title + season list;
2. poster/backdrop images;
3. the server-derived continuation season;
4. episodes for that season.

Once a season is displayed, its immediate previous and next seasons are
prefetched after 800 ms. This makes sequential browsing fast without eagerly
downloading every season of a long-running show.

## Continuation-season derivation

Migration `0033_title_detail_progress.sql` adds
`rpc_title_detail_progress(title_id)`. Postgres now returns the recommended
season and unseen-episode counts before each season instead of the browser
downloading and paging through every cached episode.

The recommendation order remains:

1. first aired, unwatched regular-season episode;
2. next upcoming cached episode;
3. latest playable season when the user has watch history;
4. first playable season otherwise.

Announced placeholder seasons with no episode count remain visible as tabs but
cannot become the default and leave the UI in an endless loading state.
Watch mutations invalidate both the watched map and this progress derivation.

## Stable detail and season UX

- The centered detail dialog no longer runs the opacity/rise animation on every
  title mount.
- First load uses fixed-height shimmer skeletons instead of fading placeholders.
- `keepPreviousData` preserves the current episode rows while another season is
  fetched. They are briefly dimmed and pointer-disabled so stale rows cannot be
  marked accidentally.
- No transient “Loading season…” label is shown; it was too short-lived to help.
- A loaded season with no episodes displays “No episodes available yet.”

## Edge-function hot path and diagnostics

Migration 0033 also adds `is_current_user_invited()`. PostgREST validates the
JWT and the function checks `auth.uid()`, combining the old `auth.getUser()` +
`is_invited(uid)` serial calls into one authenticated database round trip.

Cached proxy responses use embedded relationships and expose:

- `X-Cache: HIT | STALE | MISS`;
- `Server-Timing` entries for `gate`, `db`, optional `fill`, and `total`;
- a private five-minute HTTP cache with stale-while-revalidate.

These headers are exposed through CORS and can be inspected in browser
DevTools. A `MISS` measures TMDB plus cache writes under `fill`; a slow `HIT`
isolates latency to authentication/database/region rather than TMDB.

## Explore adjustments in the same changeset

- The discovery grid is capped at 18 visible rows in both current and catalog
  modes, allowing hidden/followed rows to be replaced from the deeper pool.
- Top-rated vote floors now account for very recent ranges: 50 votes for the
  current/previous year and 300 for the previous four years, avoiding empty
  charts before new shows can reach the historical 1000-vote threshold.

## Deployment order

Migration 0033 must be deployed before the updated `tmdb-proxy`, because the
function calls `is_current_user_invited()`:

```bash
supabase db push --linked
supabase functions deploy tmdb-proxy
```

The frontend deploys itself on push to `main`. Production is
`https://reel-app.com`.

## Verification

The implementation was verified with:

```bash
cd app
npm run check
npm run build
npm run test:e2e -- --project=chromium --grep "core loop"

cd ..
deno check supabase/functions/tmdb-proxy/index.ts
supabase db lint --local --level warning
```

The core-loop smoke test covers authentication, search, title detail, rating,
episode writes, calendar navigation, and the ratings page. It was made
idempotent so it also passes when a local database retains prior watch state.
