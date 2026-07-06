# Phase 2 — Core library loop (dogfood milestone)

Goal: the daily-driver loop, end to end, on real data: search → add → see episodes → mark
watched → know what's next → calendar → rate → stats. At the end the author retires TV Time.

Read first: ARCHITECTURE → Core derivations, Data-access conventions.
This phase ports the heart of the prototype; every commit lists its prototype reference —
**match that behavior**, including optimistic updates.

---

## P2-C1 `feat(search): ⌘K palette searching TMDB via edge proxy`

**References**: `prototype/src/marquee.tsx` → `Palette` component.

**Steps**
1. Wire the palette shell (P1-C3) to `lib/tmdb.searchShows(q)` with 300ms debounce, min 2 chars.
2. Result rows: poster thumb, name, year, network; Enter/click opens the detail sheet (P2-C3 —
   until then, a stub sheet showing the title name is acceptable **only if** P2-C3 lands in the
   same session; otherwise navigate nowhere and say so in the commit body).
3. Recent searches (localStorage, last 5) shown when the query is empty.

**Acceptance criteria**: searching "sever" surfaces Severance from TMDB and its rows exist in
`titles` afterward; keyboard: ↑↓ select, Enter opens, Esc closes.

---

## P2-C2 `feat(library): follow/unfollow (Add) + watchlist model + Shows grid with status buckets`

**References**: `prototype/src/watchlist.tsx` (the model), `prototype/src/marquee.tsx` → `Shows`.

**Steps**
1. `lib/library.ts`: queries `useLibrary()` (all followed entries + their titles) and mutations
   `useFollow()`, `useUnfollow()` — optimistic against the library query.
2. Following a title ensures full metadata: after insert, fire-and-forget `getTitle(tmdbId)` to
   pull seasons/episodes into cache.
3. `domain/status.ts`: the status derivation per ARCHITECTURE (pure; unit tests covering all
   five statuses + specials exclusion).
4. Shows screen: chip row **Watching / Caught up / Watchlist / Upcoming / Finished / All**
   (this exact order, All adjacent to Finished, Watching default), count badges, poster grid.
5. Poster progress bar for `watching` (watched/aired).

**Acceptance criteria**: add + remove reflect instantly (optimistic) and survive reload;
status buckets match the derivation tests; unfollowed shows disappear from every bucket.

---

## P2-C3 `feat(detail): show detail sheet — TMDB data, seasons/episodes, both ratings`

**References**: `prototype/src/screens.tsx` → `DetailSheet` (the whole component, including the
`rise-center` animation and layout).

**Steps**
1. `features/detail/DetailSheet.tsx` rendered as an overlay from a global `?title=<id>` search
   param (so any screen can open it and back-button closes it).
2. Hero (backdrop image w/ gradient, poster, network logo, year/genres/runtime), Add/Remove
   button (`btn-accent` when not added), synopsis.
3. Ratings card: "Your rating" editable stars + `n/10`, divider, "TMDB" community score.
4. Season selector + episode list with aired/unaired styling and watched checks (wired next commit).
5. Loading skeleton while metadata fetches; `getSeason` fetched lazily per selected season.

**Acceptance criteria**: opens from palette + poster clicks; visually matches prototype sheet;
Esc/backdrop/X close; deep link with `?title=` opens directly.

---

## P2-C4 `feat(watch): mark episode watched (optimistic), mark-up-to-here confirm, undo`

**References**: `prototype/src/screens.tsx` → `onEpClick`, `markUpTo`, the confirmation dialog.

**Steps**
1. Mutations on `watch_events`: `useMarkWatched(episodeId)`, `useUnmarkWatched`,
   `useMarkUpTo(titleId, episodeId)` (bulk insert of all aired unwatched ≤ target, one request —
   use a single `insert … select` RPC `rpc_mark_up_to(p_episode_id)` to avoid N inserts).
2. Port the exact interaction: clicking an unwatched episode with unseen priors opens the
   centered confirm ("Mark all N / Only this one"); watched click unmarks.
3. Toast with Undo (5s) after bulk marks; undo deletes the created events (track returned ids).
4. Invalidate: library statuses, up-next, stats keys.

**Acceptance criteria**: unit-test `rpc_mark_up_to` boundaries (specials skipped, unaired
skipped); UI matches prototype flow; undo restores exact prior state.

---

## P2-C5 `feat(ratings): rate shows; ratings list in You (sort + 15/page)`

**References**: `prototype/src/marquee.tsx` → `You` ratings block, `MqRatingRow`.

**Steps**
1. `useRateTitle(titleId, score)` upsert mutation (optimistic on the detail sheet stars).
2. You → "Your ratings": toolbar segmented **Newest / Oldest / Best rated / Worst rated**,
   grid rows (poster thumb, title, year·genre·"rated <relative date>", stars, score chip),
   pagination 15/page with Prev/Next pager.

**Acceptance criteria**: rating from the sheet appears in the list without reload; all four
sorts correct (ties by recency); pager bounds disabled correctly.

---

## P2-C6 `feat(upnext): up-next derivation + Tonight tab (fresh episodes, premieres, continue rail)`

**References**: `prototype/src/marquee.tsx` → `Tonight`; ARCHITECTURE → Up next.

**Steps**
1. `rpc_up_next()`: per followed watching show → earliest aired unwatched episode with air date;
   returns title + episode fields. Unit-test the SQL with seeded fixtures (pgTAP not required —
   a vitest integration test against local Supabase is acceptable; mark it `test:db` script).
2. `domain/tonight.ts`: split up-next into **Fresh episodes** (aired ≤ 7 days ago) and
   **Continue watching** (rest, by last watch activity desc).
3. **Premieres soon**: followed `upcoming` titles with a premiere date ≤ 60 days out, same row
   format as Fresh episodes (the prototype aligned these — keep it).
4. Tonight screen: hero header with date + counts, the two rails (`Rail` component) + premieres rows.

**Acceptance criteria**: marking an episode watched moves the show's up-next forward immediately;
a show with nothing aired-unwatched leaves the rails; date math tested around DST boundaries.

---

## P2-C7 `feat(calendar): chronological my-shows feed with lazy history + returning/new views`

**References**: `prototype/src/marquee.tsx` → `CalendarTab`, `MyShowsFeed`, `CalEpRow`,
`PremieresList`; ARCHITECTURE → Calendar feed. This is the most intricate port — copy the
prototype's IntersectionObserver + `useLayoutEffect` scroll-preservation approach.

**Steps**
1. `rpc_calendar_feed(p_from date, p_to date)`: episodes of followed shows in range, with
   premiere/finale flags computed in SQL (episode_number = 1; last episode_number of its season).
2. Calendar screen: sticky view switcher under the top bar (**no page header** — current
   prototype state), views **My shows / Returning series / New & announced**.
3. My shows: day groups (Today/Tomorrow/weekday ≤ 6 days, full-date headers in past, Later
   bucket beyond), local air time + network logo on future rows, watched-check on past rows,
   scroll-up loads 3 more weeks (cap 60) preserving viewport, initial auto-scroll to Today.
4. Returning/new: followed upcoming titles split by prior-season existence; bucket month/later/TBA;
   Notify-me button placeholder (wired P2-C10).
5. Badges: only Season/Series premiere + Season finale.

**Acceptance criteria**: feed groups/labels match prototype (verify against `MyShowsFeed`
behavior); upward scroll keeps the viewport steady; empty states for each view.

---

## P2-C8 `feat(edge): scheduled episode-refresh job (air dates, new seasons)`

**References**: ARCHITECTURE → TMDB integration.

**Steps**
1. Function `episode-refresh`: iterate distinct followed titles (batched, rate-limit aware:
   ≤ 40 req/10s), refresh title status + latest two seasons' episodes, upsert diffs.
2. Track `titles.last_refreshed_at`; skip titles refreshed < 20h ago.
3. Schedule daily via `supabase/config.toml` cron (or dashboard schedule — document which).
4. Emit `new_episode_detected` rows into a lightweight `job_events` table? **No** — keep scope:
   just upsert; alerting reads diffs in Phase 3 by comparing against notifications sent.

**Acceptance criteria**: manual invoke locally refreshes a stale title; second run skips it;
rate limiter unit-tested.

---

## P2-C9 `feat(you): profile stats (episodes, time, shows, coming soon, avg rating)`

**References**: `prototype/src/marquee.tsx` → `You` stats grid.

**Steps**
1. `rpc_user_stats()`: episodes watched (count watch_events), time spent (sum episode runtime,
   fallback title.episode_run_time, fallback 40min — render as days), shows followed, coming
   soon (followed upcoming count), avg rating (1 decimal), friends count (0 until Phase 4).
2. You header card (cover, avatar, name/handle, share button placeholder) + stats grid.

**Acceptance criteria**: stats match manual SQL spot-checks on the seeded data.

---

## P2-C10 `feat(notify): per-title "Notify me" flag`

**Steps**
1. `library_entries.notify` toggle mutation; button states per prototype (`Notify me` outline →
   `Tracking` accent) on calendar premiere rows and upcoming detail sheets.

**Acceptance criteria**: flag persists; **Dogfood milestone reached — author switches daily use
to the app.** Tag `v0.2.0`.
