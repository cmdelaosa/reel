import { test, expect, type Page, type Route } from "@playwright/test";

/* Loading states: every section that fetches must reserve the box its content
   will occupy, rather than rendering nothing and unfolding the page when the
   data lands.
 *
 * WHY THIS IS A SPEC AND NOT A REVIEW NOTE. The contract is a number — the
 * placeholder's height — held in two places that look nothing alike: a
 * skeleton component and the real markup plus its CSS. Nothing makes them move
 * together. Three had already drifted when these tests were first written:
 * the discover grid forgot the Add button (178px) and the Show-more row (58px),
 * the hero restated .mq-hero's frame inline and so missed its 420px desktop cap
 * (105px), and the activity skeleton drew six rows against a page of ten. Each
 * was invisible by inspection and obvious the moment the offsets were measured.
 *
 * HERMETIC ON PURPOSE. Every query the pages under test issue is fulfilled from
 * the fixtures below, so this needs no TMDB key, no seeded library, and no
 * network — and it cannot flake on either. That is not a compromise: the
 * contract under test is between the skeleton and the rendered component, and
 * where the rows came from has no bearing on it. The counts are chosen to be
 * what the sections show at rest (a full first page), because that is the case
 * the skeletons are sized for.
 *
 * WHAT IT CANNOT CATCH. How MANY rows a section will get is unknowable before
 * the query answers — an empty library still collapses Tonight's hero, and a
 * feed of three still shrinks the activity card. Only the per-item geometry and
 * the full-page case are pinned here.
 *
 * Needs the local stack (`supabase start`) and an app pointing at it:
 *   E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/loading.spec.ts
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
// supabase-js localStorage key: sb-<first hostname label>-auth-token.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Long enough to read the loading state without racing it, short enough that
 *  five tests stay quick. */
const HOLD_MS = 2500;

/** Sign in via the auth API and inject the session so the app boots authed.
 *  Same trick as smoke.spec.ts — the magic-link UI is not what is under test. */
async function authenticate(page: Page) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), "password grant should succeed — is the test user seeded?").toBeTruthy();
  const session = await res.json();
  await page.addInitScript(
    ([ref, sess]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess)),
    [PROJECT_REF, session] as const,
  );
}

/* ── fixtures ──────────────────────────────────────────────────────────────
   Real TMDB paths, so the <img> tags resolve and the boxes fill the way they
   do in the app. Ids sit outside TMDB's real space; nothing is written. */

const POSTER = "/2Nsc9Wa2rzcxk8ZfynOMFFgVvUv.jpg";
const BACKDROP = "/dJZ8Rmt1CoSY4xzTLIfrhaJHrgg.jpg";
const uuid = (tag: number, i: number) => `00000000-0000-4000-800${tag}-${String(i).padStart(12, "0")}`;

/** DiscoverSections reveals PAGE_SIZE (18) cards and, when the pool is deeper,
 *  a Show-more button. 24 exercises both — a full grid AND the button, which is
 *  the pair the skeleton has to reserve. */
const DISCOVER_POOL = 24;

const titleRow = (i: number) => ({
  id: uuid(3, i),
  tmdb_id: 900000 + i,
  kind: "tv",
  name: `Fixture Show ${i}`,
  overview: null,
  poster_path: POSTER,
  backdrop_path: BACKDROP,
  first_air_date: "2024-03-11",
  status: "Returning Series",
  genres: ["Drama"],
  network: "AMC",
  episode_run_time: 47,
  vote_average: 8.4,
  popularity: 100 - i,
});

/** Seven shows in progress: one becomes the hero, six fill the rail — which is
 *  exactly what RailCardsSkeleton draws. */
const upNextRows = () =>
  Array.from({ length: 7 }, (_, i) => ({
    title_id: uuid(0, i),
    tmdb_id: 900000 + i,
    name: `Fixture Show ${i}`,
    poster_path: POSTER,
    backdrop_path: BACKDROP,
    network: "AMC",
    vote_average: 8.4,
    episode_id: uuid(1, i),
    season_number: 2,
    episode_number: i + 1,
    episode_name: `Episode ${i + 1}`,
    runtime: 47,
    air_datetime: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    aired_count: 20,
    watched_count: 7,
    last_watched_at: new Date(Date.now() - (i + 1) * 7200_000).toISOString(),
  }));

/** Three aired in the last five days and three premiering later — one row per
 *  column of Tonight's lower half, matching RowsSkeleton's three. */
const calendarRows = () => {
  const day = 86_400_000;
  const row = (i: number, at: number, premiere: boolean) => ({
    episode_id: uuid(2, i),
    title_id: uuid(0, i),
    tmdb_id: 900000 + i,
    show_name: `Fixture Show ${i}`,
    poster_path: POSTER,
    network: "AMC",
    season_number: 2,
    episode_number: i + 1,
    episode_name: `Episode ${i + 1}`,
    air_datetime: new Date(at).toISOString(),
    air_time_source: "tvmaze",
    is_premiere: premiere,
    is_finale: false,
    watch_event_id: null,
  });
  return [
    ...Array.from({ length: 3 }, (_, i) => row(i, Date.now() - (i + 1) * day, false)),
    ...Array.from({ length: 3 }, (_, i) => row(10 + i, Date.now() + (i + 3) * day, true)),
  ];
};

/** A full first page of the activity feed (FEED_PAGE in FriendActivityCard). */
const activityRows = () =>
  Array.from({ length: 10 }, (_, i) => ({
    friend_id: uuid(4, i % 2),
    friend_name: i % 2 ? "Ana Ruiz" : "Leo Park",
    friend_avatar: null,
    verb: "watched",
    tmdb_id: 900000 + i,
    title_name: `Fixture Show ${i}`,
    poster_path: POSTER,
    score: null,
    season_number: 2,
    episode_number: i + 1,
    to_season: 2,
    to_episode: i + 1,
    ep_count: 1,
    at: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    event_key: `w:${uuid(4, i % 2)}:${uuid(0, i)}:2026-08-06`,
  }));

/** One accepted friend, so the Friends page renders its social sections
 *  regardless of which account the run signed in as (CI's is friendless). */
const friendshipRows = () => [{
  other_id: uuid(4, 0),
  handle: "ana",
  display_name: "Ana Ruiz",
  avatar_url: null,
  status: "accepted",
  incoming: false,
  watching_title: null,
  watching_tmdb: null,
  watching_season: null,
  watching_episode: null,
}];

/** The tile count TileGridSkeleton draws. Collections is the last section on
 *  Explore, so a mismatch here shifts nothing — matching it keeps the test
 *  about tile geometry rather than about how many collections exist. */
const collectionRows = () =>
  Array.from({ length: 6 }, (_, i) => ({
    id: uuid(5, i),
    slug: `fixture-${i}`,
    name: `Fixture Collection ${i}`,
    sub: "A handful of shows",
    hue: (i * 60) % 360,
    position: i,
  }));

/** Answer `pattern` with `body`, held back `delayMs` so the loading state is
 *  observable. Returning a fixture rather than delaying the real call is what
 *  makes the measurement below deterministic.
 *
 *  Pass 0 for a query the page needs answered BEFORE the section under test
 *  will even render a placeholder — hold both and they land together, the
 *  skeleton never appears, and the measurement compares content against
 *  content. (That is not hypothetical: it is how the Friends test first passed
 *  against a deliberately broken skeleton.) */
async function hold(page: Page, pattern: string, body: unknown, delayMs = HOLD_MS) {
  await page.route(pattern, async (route: Route) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

/** Every top-level section's distance from the top of the page. Equal before
 *  and after the data lands means nothing moved under the reader. */
const offsets = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, number> = {};
    document.querySelectorAll<HTMLElement>(".screen > *").forEach((el, i) => {
      out[String(i)] = Math.round(el.getBoundingClientRect().top + window.scrollY);
    });
    return out;
  });

/** Sub-pixel rounding and a hairline border are not a layout shift; a missing
 *  button row is. Anything a reader could notice lands well outside this. */
const SHIFT_TOLERANCE_PX = 4;

async function expectNoShift(page: Page, waitFor: () => Promise<unknown>) {
  // The whole measurement is worthless if the placeholder has already been
  // replaced — `before` and `after` would both be the finished page and the
  // comparison would pass no matter how wrong the skeleton was. Fail loudly
  // instead of quietly proving nothing.
  await expect(
    page.locator(".skeleton"),
    "no skeleton on screen — the fixtures resolved before the loading state could be measured",
  ).not.toHaveCount(0);
  const before = await offsets(page);
  await waitFor();
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 20_000 });
  const after = await offsets(page);

  // A section that placeholders and then renders nothing is the same bug seen
  // from the other side, and defaulting its missing offset to the old one would
  // wave it through — so compare the shape first.
  expect(
    Object.keys(after).length,
    "a section that drew a placeholder is no longer on the page",
  ).toBe(Object.keys(before).length);

  for (const [key, top] of Object.entries(before)) {
    expect(
      Math.abs(after[key] - top),
      `section ${key} moved ${after[key] - top}px between the skeleton and the content`,
    ).toBeLessThanOrEqual(SHIFT_TOLERANCE_PX);
  }
}

test("Tonight holds the hero, the rail and both columns", async ({ page }) => {
  await authenticate(page);
  await hold(page, "**/rpc/rpc_up_next", upNextRows());
  await hold(page, "**/rpc/rpc_calendar_feed", calendarRows());
  await page.goto("/tonight");

  // The banner claims its box before it has anything to show in it.
  const heroSkeleton = page.locator(".mq-bento .skeleton");
  await expect(heroSkeleton).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue watching" })).toBeVisible();
  await expect(page.locator(".rail .skeleton").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fresh episodes" })).toBeVisible();

  await expectNoShift(page, () => expect(page.locator(".mq-hero")).toBeVisible());
});

test("Tonight's hero placeholder is the same box as the hero", async ({ page }) => {
  // Guards the .mq-hero / .mq-hero-frame pair in marquee.css specifically: the
  // frame is capped at 420px above 1035px wide and floored at 262px on a phone,
  // and an inline copy of "21/9, min 240" silently loses both.
  await authenticate(page);
  await hold(page, "**/rpc/rpc_up_next", upNextRows());
  await hold(page, "**/rpc/rpc_calendar_feed", calendarRows());
  await page.goto("/tonight");

  const placeholder = await page.locator(".mq-bento .skeleton").boundingBox();
  await expect(page.locator(".mq-hero")).toBeVisible();
  const hero = await page.locator(".mq-hero").boundingBox();
  expect(Math.abs(hero!.height - placeholder!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(hero!.width - placeholder!.width)).toBeLessThanOrEqual(1);
});

test("Explore paints trending, the discover grid and collections in place", async ({ page }) => {
  await authenticate(page);
  await hold(page, "**/tmdb-proxy/trending", { results: Array.from({ length: 12 }, (_, i) => titleRow(i)) });
  await hold(page, "**/tmdb-proxy/popular-now", { results: Array.from({ length: DISCOVER_POOL }, (_, i) => titleRow(i)) });
  await hold(page, "**/rest/v1/collections*", collectionRows());
  await page.goto("/explore");

  // All three sections are on screen at once — the bug was Collections sitting
  // alone for two seconds and then being shoved down twice.
  await expect(page.getByRole("heading", { name: "Trending this week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
  await expect(page.locator(".rail .skeleton").first()).toBeVisible();

  await expectNoShift(page, () => expect(page.getByRole("button", { name: "Show more" })).toBeVisible());
});

test("Explore fetches only the tab it is showing", async ({ page }) => {
  await authenticate(page);
  const hits: string[] = [];
  await page.route("**/tmdb-proxy/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.split("/tmdb-proxy")[1];
    hits.push(path.split("?")[0]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: Array.from({ length: DISCOVER_POOL }, (_, i) => titleRow(i)) }),
    });
  });
  await page.goto("/explore");
  await expect(page.getByRole("button", { name: "Show more" })).toBeVisible();

  expect(hits, "Popular now is the tab on screen").toContain("/popular-now");
  expect(hits, "Top rated is not on screen, so it must not be fetched").not.toContain("/top-rated");

  // Opening the tab is what pays for it.
  await page.getByRole("tab", { name: "Top rated" }).click();
  await expect.poll(() => hits).toContain("/top-rated");
});

test("Friends holds the activity feed's rows while it loads", async ({ page }) => {
  await authenticate(page);
  // Friendships answers immediately and the feed lags, which is both the real
  // shape of the page and the only ordering in which the feed's placeholder is
  // ever on screen: the card draws nothing until it knows there are friends.
  await hold(page, "**/rpc/rpc_my_friendships", friendshipRows(), 0);
  await hold(page, "**/rpc/rpc_friend_activity", activityRows());
  await page.goto("/friends");

  await expect(page.locator(".fr-activity .skeleton").first()).toBeVisible();
  await expectNoShift(page, () => expect(page.getByText("Ana Ruiz").first()).toBeVisible());
});

test("the activity feed does not queue behind the friendships query", async ({ page }) => {
  // Gating the feed on hasFriends put the page's slowest RPC second in a chain.
  await authenticate(page);
  const startedAt: Record<string, number> = {};
  await page.route("**/rpc/rpc_*", async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    startedAt[name] ??= Date.now();
    await route.continue();
  });
  await page.goto("/friends");

  await expect.poll(() => startedAt["rpc_friend_activity"] ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => startedAt["rpc_my_friendships"] ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  // In series these were hundreds of ms apart; in parallel they leave together.
  const gap = Math.abs(startedAt["rpc_friend_activity"] - startedAt["rpc_my_friendships"]);
  expect(gap, `activity started ${gap}ms after friendships`).toBeLessThan(250);
});
