import { test, expect, type Page } from "@playwright/test";

/* The two ways into My Shows with a bucket already chosen:

   - the Watchlist tab in the nav (and its twin in the phone dock) opens the
     library on "Not started";
   - Tonight's continue-watching rail carries a "See all" that opens it on
     "Watching" — and unlike the rail's scroll arrows, that link has to survive
     on a touch device, where `@media (hover: none)` hides .rail-nav.

   Both hang on ShowsPage reading its bucket from ?filter=, which is also what
   makes the tab work when you are already standing on /shows: local state would
   simply ignore a same-route navigation.

   Needs the local stack (`supabase start`) and an app pointing at it — see the
   "app-local" launch config:

     E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/watchlist-nav.spec.ts

   Env (defaults target the local stack):
     E2E_SUPABASE_URL        default http://127.0.0.1:54321
     E2E_ANON_KEY            anon/publishable key
     E2E_SERVICE_ROLE_KEY    service-role key (seeds the two in-progress shows)
     E2E_EMAIL/PASSWORD      default cmo@example.com / password123 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.E2E_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
// Outside TMDB's real id space, like the reactions fixture.
const FIXTURE = [
  { tmdb_id: 999000101, name: "E2E Continue One" },
  { tmdb_id: 999000102, name: "E2E Continue Two" },
];

async function authenticate(page: Page): Promise<string> {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), "password grant should succeed — is the test user seeded?").toBeTruthy();
  const session = await res.json();
  await page.addInitScript(
    ([ref, sess]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
    },
    [PROJECT_REF, session] as const,
  );
  return session.user.id as string;
}

async function rest(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: token === SERVICE ? SERVICE : ANON_KEY,
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
}

/** Named deletes, not blanket ones — the local stack is also somebody's
 *  dogfood database. Episodes, watch events and library rows cascade off the
 *  title. Runs before seeding too, so a killed run leaves nothing behind to
 *  fail the next one's insert. */
async function clearFixture(): Promise<void> {
  for (const f of FIXTURE) await rest(SERVICE, `titles?tmdb_id=eq.${f.tmdb_id}`, { method: "DELETE" });
}

/** Two shows, three aired episodes each, the first one watched: both derive as
 *  "watching", so one becomes Tonight's hero and the other fills the rail —
 *  which is the only state where the rail (and its "See all") renders at all. */
async function seedTwoInProgress(userId: string): Promise<void> {
  for (const f of FIXTURE) {
    const title = await (await rest(SERVICE, "titles", {
      method: "POST",
      body: JSON.stringify({ tmdb_id: f.tmdb_id, kind: "tv", name: f.name, status: "Returning Series" }),
    })).json();
    const titleId = title[0].id as string;

    const episodes = await (await rest(SERVICE, "episodes", {
      method: "POST",
      body: JSON.stringify([1, 2, 3].map((n) => ({
        title_id: titleId,
        season_number: 1,
        episode_number: n,
        name: `${f.name} E${n}`,
        // Aired, and spread apart so "up next" is unambiguous.
        air_datetime: new Date(Date.now() - (10 - n) * 86_400_000).toISOString(),
      }))),
    })).json();

    await rest(SERVICE, "library_entries", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, title_id: titleId, followed: true }),
    });
    await rest(SERVICE, "watch_events", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, episode_id: episodes[0].id }),
    });
  }
}

/** The bucket chip the page is filtered by. */
function activeBucket(page: Page) {
  return page.locator(".shows-buckets .chip.chip-active");
}

/** The sort the page is ordered by. */
function activeSort(page: Page) {
  return page.locator(".segmented .seg.seg-active");
}

test("the Watchlist tab opens My Shows on Not started, newest first", async ({ page }) => {
  await authenticate(page);
  await page.goto("/tonight");

  await page.locator(".mq-tabs").getByRole("link", { name: "Watchlist" }).click();
  await expect(page).toHaveURL(/\/shows\?filter=watchlist/);
  await expect(activeBucket(page)).toHaveText(/Not started/);
  // Nothing in this bucket has ever been watched, so "Last watched" would be
  // ordering by a column that is null for every row.
  await expect(activeSort(page)).toHaveText(/Last released/);

  // And it still gets you there from inside My Shows, where the route doesn't
  // change — the regression that made the bucket URL-driven in the first place.
  await page.locator(".shows-buckets .chip", { hasText: "All" }).click();
  await expect(activeBucket(page)).toHaveText(/All/);
  await expect(activeSort(page)).toHaveText(/Last watched/);
  await page.locator(".mq-tabs").getByRole("link", { name: "Watchlist" }).click();
  await expect(activeBucket(page)).toHaveText(/Not started/);
  await expect(activeSort(page)).toHaveText(/Last released/);
});

test("a sort you picked yourself outlives the bucket you picked it in", async ({ page }) => {
  await authenticate(page);
  await page.goto("/shows?filter=watchlist");
  await expect(activeSort(page)).toHaveText(/Last released/);

  await page.locator(".segmented .seg", { hasText: "A–Z" }).click();
  await expect(activeSort(page)).toHaveText(/A–Z/);
  // The per-bucket default only fills in for someone who hasn't chosen.
  await page.locator(".shows-buckets .chip", { hasText: "Watching" }).click();
  await expect(activeSort(page)).toHaveText(/A–Z/);
  await page.locator(".shows-buckets .chip", { hasText: "Not started" }).click();
  await expect(activeSort(page)).toHaveText(/A–Z/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the dock's Watchlist button opens My Shows on Not started", async ({ page }) => {
    await authenticate(page);
    await page.goto("/tonight");

    await page.locator(".mq-dock").getByRole("link", { name: "Watchlist" }).click();
    await expect(page).toHaveURL(/\/shows\?filter=watchlist/);
    await expect(activeBucket(page)).toHaveText(/Not started/);
  });

  test("continue watching keeps its See all where the arrows are hidden", async ({ page }) => {
    test.skip(!SERVICE, "needs E2E_SERVICE_ROLE_KEY to seed two in-progress shows");
    const userId = await authenticate(page);
    await clearFixture();
    await seedTwoInProgress(userId);

    try {
      await page.goto("/tonight");
      const rail = page.locator(".rail-wrap", { hasText: "Continue watching" });
      const seeAll = rail.getByRole("link", { name: /See all/ });
      await expect(seeAll).toBeVisible();
      // The arrows are gone here — the point of the assertion above.
      await expect(rail.locator(".rail-nav")).toBeHidden();

      await seeAll.click();
      await expect(page).toHaveURL(/\/shows\?filter=watching/);
      await expect(activeBucket(page)).toHaveText(/Watching/);
    } finally {
      await clearFixture();
    }
  });
});
