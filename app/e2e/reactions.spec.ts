import { test, expect, type Browser, type Page } from "@playwright/test";

/* Reactions on the activity feed (0058), with two people on screen at once:
   Ana reacts to Carlos's binge, her chip lands on the row, and Carlos's bell
   rings with a notification that names her — live, without a reload. Then Leo
   piles on and the same notification is rewritten instead of a second one
   arriving, which is the whole point of the grouped inbox row.

   Needs the local Supabase stack (`supabase start`, seeded demo accounts) AND
   an app under test pointing at it — app/.env.local may well point at the
   hosted project, so use the "app-local" launch config:

     E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/reactions.spec.ts

   Env (defaults target the local stack):
     E2E_SUPABASE_URL default http://127.0.0.1:54321
     E2E_ANON_KEY     default the local publishable key */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
// supabase-js localStorage key: sb-<first hostname label>-auth-token.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const PASSWORD = "password123";

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

/** PostgREST as a given user, so RLS applies exactly as it does in the app. */
function rest(session: Session, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

test("a friend's reaction lands on the row, rings the bell, and groups", async ({ browser }) => {
  const ana = await signedIn(browser, "ana@example.com");
  const leo = await signedIn(browser, "leo@example.com");
  const carlos = await signedIn(browser, "cmo@example.com");

  // Idempotent: a rerun must not toggle off what the last run left behind.
  await rest(ana.session, `activity_reactions?user_id=eq.${ana.session.user.id}`, { method: "DELETE" });
  await rest(leo.session, `activity_reactions?user_id=eq.${leo.session.user.id}`, { method: "DELETE" });

  await carlos.page.goto("/friends");
  await expect(carlos.page.getByRole("heading", { name: "Activity" })).toBeVisible();
  // The wall shows Carlos his own rows — otherwise reactions to them would be
  // invisible to the one person they are about.
  await expect(carlos.page.locator(".fr-activity", { hasText: "You watched" }).first()).toBeVisible();

  await ana.page.goto("/friends");
  const row = ana.page.locator(".fr-activity", { hasText: "Carlos watched" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "React" }).click();
  await ana.page.getByRole("menuitem", { name: "🔥" }).click();

  const anasChip = row.locator(".rx-chip.rx-mine");
  await expect(anasChip).toContainText("🔥");
  await expect(anasChip).toContainText("1");

  // Carlos never reloaded: Realtime carries the insert.
  await expect(carlos.page.locator(".mq-belldot")).toBeVisible({ timeout: 15_000 });
  await carlos.page.getByRole("button", { name: "Notifications" }).click();
  const notif = carlos.page.getByText(/Ana Ruiz reacted 🔥 to/);
  await expect(notif).toBeVisible();

  // Leo is not Ana's friend, but he shares Carlos: his reaction rewrites the
  // same inbox row rather than opening a second one.
  const readBack = await rest(ana.session, `activity_reactions?user_id=eq.${ana.session.user.id}&select=*`);
  const mine = await readBack.text();
  expect(readBack.ok, `read back Ana's reaction: ${mine}`).toBeTruthy();
  const [target] = JSON.parse(mine) as { event_key: string; actor_id: string; title_id: string }[];
  const added = await rest(leo.session, "activity_reactions", {
    method: "POST",
    body: JSON.stringify({
      event_key: target.event_key,
      user_id: leo.session.user.id,
      actor_id: target.actor_id,
      title_id: target.title_id,
      emoji: "😱",
    }),
  });
  expect(added.ok, "Leo can react to an event of his own friend").toBeTruthy();

  await expect(carlos.page.getByText(/Ana Ruiz and Leo Park reacted to/)).toBeVisible({ timeout: 15_000 });
  await expect(carlos.page.getByText(/reacted/)).toHaveCount(1);

  // Following it lands on the row itself, where both reactions are legible —
  // including Leo's, whom Ana cannot see in her own friends list.
  await carlos.page.getByText(/Ana Ruiz and Leo Park reacted to/).click();
  await expect(carlos.page).toHaveURL(/\/friends\?event=/, { timeout: 2_000 });
  const carlosRow = carlos.page.locator(".fr-activity", { hasText: "You watched" }).first();
  await expect(carlosRow.locator(".rx-chip")).toHaveCount(2);

  // Ana gets no notification for a reaction on someone else's row, so her
  // chips catch up on the next fetch rather than streaming in — deliberate:
  // one live channel (the inbox) is enough for a group this size.
  await ana.page.reload();
  await expect(ana.page.locator(".fr-activity", { hasText: "Carlos watched" }).first().locator(".rx-chip"))
    .toHaveCount(2, { timeout: 15_000 });

  // Withdrawing the last reaction takes the notification with it.
  await rest(ana.session, `activity_reactions?user_id=eq.${ana.session.user.id}`, { method: "DELETE" });
  await rest(leo.session, `activity_reactions?user_id=eq.${leo.session.user.id}`, { method: "DELETE" });
  await expect(carlos.page.getByText(/reacted/)).toHaveCount(0, { timeout: 15_000 });
});
