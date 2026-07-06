# Phase 4 — Social

Goal: the prototype's friends layer, live: friendships, friend profiles with match %, and the
friend-powered Explore sections + activity feed.

Read first: ARCHITECTURE → Social & system, Match %.
Prototype reference for **everything visual** in this phase: `prototype/src/friends.tsx` and the
sections added to `prototype/src/marquee.tsx` (You → Friends, Explore → Popular with friends /
Best rated by friends / Friend activity).

---

## P4-C1 `feat(social): friendships — request, accept, remove; friends section in You`

**Steps**
1. Migration `000N_friend_read_policies.sql`: the friend-read `select` policies on `profiles`,
   `library_entries`, `watch_events`, `ratings` per ARCHITECTURE (via `is_friend` helper +
   `is_private` respect). **This is the security-sensitive commit — keep the policies minimal
   and add SQL tests** (vitest `test:db`) proving: non-friend sees nothing, pending sees nothing,
   accepted friend sees rows, private profile hides everything.
2. Friend search: RPC `rpc_find_profile(p_handle)` (exact handle match only — no browsing).
3. Requests UI: You → Friends section header "Add friend" (handle input) → creates `pending`;
   incoming requests rendered atop the friends list with Accept/Decline; `friend_request`
   notification on create.
4. Friends list: cards per prototype `FriendCard` (avatar, name, "Watching <title>" from their
   latest watch event's show, chevron).

**Acceptance criteria**: full request→accept loop between two local users; decline removes;
RLS tests green.

---

## P4-C2 `feat(social): friend profile sheet (stats, match %, watching now, follows, top ratings)`

**References**: `prototype/src/friends.tsx` → `FriendSheet` — match it section by section.

**Steps**
1. Route param `?friend=<profile_id>` overlay (same pattern as detail sheet; detail stacks on top).
2. Data: friend profile + `rpc_friend_snapshot(p_friend)` returning follows (title cards),
   ratings, watching-now (their up-next shows with S·E), stats — one round trip.
3. Sections: cover (hue from handle hash) + identity; stats (shows/episodes/rated);
   **match %** bar (shared followed / their followed, shared highlighted); Watching now rows
   (open detail); Follows grid (`fr-mini` tiles, common ones accent-ringed); Their top ratings.

**Acceptance criteria**: matches prototype sheet visually; every show inside opens the real
detail sheet on top; private/non-friend profiles return a "not available" state, not an error.

---

## P4-C3 `feat(social): explore sections — popular with friends, best rated by friends (RPCs)`

**Steps**
1. `rpc_popular_with_friends()`: titles followed by ≥ 2 accepted friends → title card + friend
   list (id, name, hue) ordered by count desc, avg friend rating desc. `security invoker`.
2. `rpc_best_rated_by_friends()`: titles rated by ≥ 2 friends → avg + raters, ordered avg desc.
3. Explore sections per prototype: rail with `FriendStack` avatar overlays + "N friends";
   rows with poster, stack, `x.x/10` score chip.
4. `FriendAvatar` / `FriendStack` ported to `app/src/ui/` (initials + hue gradient; hue from
   a stable hash of profile id).

**Acceptance criteria**: with seeded local friends the sections mirror prototype behavior;
sections hide entirely when the user has < 2 friends (no sad empties on day one).

---

## P4-C4 `feat(social): activity feed (rated/finished/added/started) in Explore`

**Steps**
1. `rpc_friend_activity(p_limit)`: union of friends' recent `ratings` (rated), `library_entries`
   (added), and watch_events milestones — **started** (first event of a title) and **finished
   season** (event completing a season) — with timestamps, ordered desc, limit 30.
   Compute milestone flags in SQL window functions; keep it one query.
2. Explore "Friend activity" card: rows per prototype `ActivityRow` (avatar → friend sheet,
   bold title → detail sheet, score chip when rating, relative time).
3. Relative-time helper in `domain/time.ts` (unit-tested: 2h ago / yesterday / 3 days ago).

**Acceptance criteria**: performing actions as friend-user A shows up in B's feed on refetch;
ordering and labels match prototype.
