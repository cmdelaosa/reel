import { test, expect, type Browser, type Page } from "@playwright/test";

/* Reactions on the activity feed (0058), with two people on screen at once:
   Ana reacts to Carlos's binge, her chip lands on the row, and Carlos's bell
   rings with a notification that names her — live, without a reload. Then Leo
   piles on and the same notification is rewritten instead of a second one
   arriving, and when both withdraw it disappears from the panel by itself.

   The spec seeds its own show, episodes and watch events with the service role
   and removes them afterwards: `supabase/seed/dev.sql` seeds identity and
   friendships only ("It seeds identity + social only"), so on CI the feed would
   otherwise be empty and every assertion here would time out. It needs the
   local stack (`supabase start`) and an app under test pointing at it —
   app/.env.local may well point at the hosted project, so use the "app-local"
   launch config:

     E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/reactions.spec.ts

   Env (CI sets these; defaults target the local stack):
     E2E_SUPABASE_URL        default http://127.0.0.1:54321
     E2E_ANON_KEY            anon/publishable key
     E2E_SERVICE_ROLE_KEY    service-role key (seeds the fixture) */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.E2E_SERVICE_ROLE_KEY ?? "";
// supabase-js localStorage key: sb-<first hostname label>-auth-token.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const PASSWORD = "password123";
// Seeded demo accounts: Carlos is friends with both, Ana and Leo are not
// friends with each other — which is what makes Leo's chip on Ana's screen a
// real test of "whoever sees the event sees every reaction on it".
const CARLOS = "cmo@example.com";
const ANA = "ana@example.com";
const LEO = "leo@example.com";
const FIXTURE_TMDB_ID = 999000058; // outside TMDB's real id space

interface Session {
  access_token: string;
  user: { id: string };
}

async function passwordGrant(email: string): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.ok, `password grant for ${email} — is the dev seed loaded?`).toBeTruthy();
  return (await res.json()) as Session;
}

/** A page in its own context, already signed in as `email`. */
async function signedIn(browser: Browser, email: string): Promise<{ page: Page; session: Session }> {
  const session = await passwordGrant(email);
  const context = await browser.newContext();
  await context.addInitScript(
    ([ref, sess]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
    },
    [PROJECT_REF, session] as const,
  );
  return { page: await context.newPage(), session };
}

/** PostgREST as a given user (RLS applies exactly as it does in the app), or as
 *  the service role when `token` is the service key (fixture setup only). */
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

async function seedBinge(watcherId: string): Promise<{ titleId: string }> {
  // Three episodes of one show, all watched a minute ago: one same-day burst,
  // and the newest thing in anyone's feed, so it lands at the top.
  const title = await (await rest(SERVICE, "titles", {
    method: "POST",
    body: JSON.stringify({ tmdb_id: FIXTURE_TMDB_ID, kind: "tv", name: "E2E Reaction Show" }),
  })).json();
  const titleId = title[0].id as string;

  const episodes = await (await rest(SERVICE, "episodes", {
    method: "POST",
    body: JSON.stringify([1, 2, 3].map((n) => ({
      title_id: titleId, season_number: 1, episode_number: n, name: `Fixture ${n}`,
    }))),
  })).json();

  const watchedAt = new Date(Date.now() - 60_000).toISOString();
  const events = await rest(SERVICE, "watch_events", {
    method: "POST",
    body: JSON.stringify((episodes as { id: string }[]).map((e) => ({
      user_id: watcherId, episode_id: e.id, watched_at: watchedAt, source: "seed",
    }))),
  });
  expect(events.ok, "seed watch events").toBeTruthy();
  return { titleId };
}

test("a friend's reaction lands on the row, rings the bell, and groups", async ({ browser }) => {
  test.skip(!SERVICE, "needs E2E_SERVICE_ROLE_KEY to seed the fixture show");

  const ana = await signedIn(browser, ANA);
  const leo = await signedIn(browser, LEO);
  const carlos = await signedIn(browser, CARLOS);
  const { titleId } = await seedBinge(carlos.session.user.id);

  try {
    await carlos.page.goto("/friends");
    await expect(carlos.page.getByRole("heading", { name: "Activity" })).toBeVisible();
    // The wall shows Carlos his own rows — otherwise reactions to them would be
    // invisible to the one person they are about.
    const carlosRow = carlos.page.locator(".fr-activity", { hasText: "E2E Reaction Show" }).first();
    await expect(carlosRow).toContainText("You watched");

    await ana.page.goto("/friends");
    const row = ana.page.locator(".fr-activity", { hasText: "E2E Reaction Show" }).first();
    await expect(row).toContainText("Carlos watched");
    // The whole burst, counted over the day rather than over the row budget.
    await expect(row).toContainText("3 episodes");

    await row.getByRole("button", { name: "React", exact: true }).click();
    // Exact: a chip's own label starts with the same word ("Brilliant, 2: …").
    await ana.page.getByRole("button", { name: "Brilliant", exact: true }).click();

    // The chip shows the emoji plus faces; who and how many live in its label,
    // which is also what a screen reader gets.
    const anasChip = row.locator(".rx-chip.rx-mine");
    await expect(anasChip).toContainText("🔥");
    await expect(anasChip).toHaveAttribute("aria-label", "Brilliant, 1: Ana Ruiz");

    // Tapping a chip opens who reacted with what, plus + / − to change yours.
    await anasChip.click();
    const detail = ana.page.locator(".rx-detail");
    // Ana is looking at her own reaction, so the list names her "You".
    await expect(detail).toContainText("You");
    await expect(detail.getByRole("button", { name: "Add a reaction" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Remove my reaction" })).toBeVisible();
    await ana.page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    // Carlos never reloaded: Realtime carries the insert.
    await expect(carlos.page.locator(".mq-belldot")).toBeVisible({ timeout: 15_000 });
    await carlos.page.getByRole("button", { name: "Notifications" }).click();
    await expect(carlos.page.getByText(/Ana Ruiz reacted 🔥 to/)).toBeVisible();

    // Leo is not Ana's friend, but he shares Carlos: his reaction rewrites the
    // same inbox row rather than opening a second one.
    const added = await rest(leo.session.access_token, "activity_reactions", {
      method: "POST",
      // Only the key: actor and title are derived from it server-side.
      body: JSON.stringify({
        event_key: await eventKeyOf(ana.session.access_token, carlos.session.user.id, titleId),
        user_id: leo.session.user.id,
        emoji: "😱",
      }),
    });
    expect(added.ok, `Leo can react to an event of his own friend: ${await added.text()}`).toBeTruthy();

    await expect(carlos.page.getByText(/Ana Ruiz and Leo Park reacted to/)).toBeVisible({ timeout: 15_000 });
    await expect(carlos.page.getByText(/reacted/)).toHaveCount(1);

    // Following it lands on the row itself, where both reactions are legible —
    // including Leo's, whom Ana cannot see in her own friends list.
    await carlos.page.getByText(/Ana Ruiz and Leo Park reacted to/).click();
    await expect(carlos.page).toHaveURL(/\/friends\?event=/, { timeout: 2_000 });
    await expect(carlosRow.locator(".rx-chip")).toHaveCount(2);

    // Ana gets no notification for a reaction on someone else's row, so her
    // chips catch up on the next fetch rather than streaming in — deliberate:
    // one live channel (the inbox) is enough for a group this size.
    await ana.page.reload();
    await expect(ana.page.locator(".fr-activity", { hasText: "E2E Reaction Show" }).first()
      .locator(".rx-chip")).toHaveCount(2, { timeout: 15_000 });

    // Withdrawing the last reaction takes the notification with it — checked
    // with the panel OPEN, since a closed panel would report zero either way.
    for (const who of [ana, leo]) {
      const gone = await rest(who.session.access_token,
        `activity_reactions?user_id=eq.${who.session.user.id}`, { method: "DELETE" });
      expect(gone.ok, "withdraw reaction").toBeTruthy();
    }
    await carlos.page.getByRole("button", { name: "Notifications" }).click();
    await expect(carlos.page.getByText(/reacted/)).toHaveCount(0, { timeout: 15_000 });
    await expect(carlos.page.locator(".mq-belldot")).toHaveCount(0);
  } finally {
    // Cascades take the episodes, watch events and reactions with the title.
    await rest(SERVICE, `titles?tmdb_id=eq.${FIXTURE_TMDB_ID}`, { method: "DELETE" });
    await rest(SERVICE, `notifications?type=eq.reaction`, { method: "DELETE" });
    for (const p of [ana, leo, carlos]) await p.page.context().close();
  }
});

/** The key the feed minted for Carlos's burst, read back as one of his friends
 *  — the same string the UI reacted to, rather than one rebuilt by hand here. */
async function eventKeyOf(token: string, actorId: string, titleId: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_friend_activity`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ p_limit: 30 }),
  });
  const feed = (await res.json()) as { event_key?: string; friend_id: string; title_id: string }[];
  const row = feed.find((r) => r.friend_id === actorId && r.title_id === titleId);
  expect(row?.event_key, "the fixture burst is in the feed").toBeTruthy();
  return row!.event_key!;
}
