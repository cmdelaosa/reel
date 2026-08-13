import { test, expect, type Page } from "@playwright/test";

/* Emptying the inbox: one tap, and the rows animate out.

   "Clear" used to arm itself and ask "Sure?" on the second tap. It no longer
   asks — so the only thing left saying it worked is the sweep, and the sweep
   only exists because the panel holds a snapshot of the rows: the delete is
   optimistic, so by the time the animation would start the rows are already out
   of the cache. Both halves are asserted here.

   Needs the local stack (`supabase start`) and an app pointing at it — see the
   "app-local" launch config:

     E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/notif-clear.spec.ts

   Env (defaults target the local stack):
     E2E_SUPABASE_URL        default http://127.0.0.1:54321
     E2E_ANON_KEY            anon/publishable key
     E2E_SERVICE_ROLE_KEY    service-role key — notifications have no insert
                             policy, so only the service role can seed an inbox
     E2E_EMAIL/PASSWORD      default cmo@example.com / password123 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.E2E_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const ROWS = 4;

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

async function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
}

test("Clear empties the inbox on one tap, sweeping the rows out", async ({ page }) => {
  test.skip(!SERVICE, "needs E2E_SERVICE_ROLE_KEY to seed an inbox");
  const userId = await authenticate(page);

  // Whatever this account already had would be cleared by the click too, so the
  // count assertions have to start from a known inbox.
  await rest(`notifications?user_id=eq.${userId}`, { method: "DELETE" });
  await rest("notifications", {
    method: "POST",
    body: JSON.stringify(
      Array.from({ length: ROWS }, (_, i) => ({
        user_id: userId,
        type: "new_episode",
        payload: { show_name: `E2E Clear ${i + 1}`, season_number: 1, episode_number: i + 1 },
      })),
    ),
  });

  await page.goto("/tonight");
  await page.getByRole("button", { name: "Notifications" }).click();
  const panel = page.locator(".mq-notif");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("E2E Clear 1")).toBeVisible();

  // Count the sweeps as they start rather than trying to catch the class inside
  // a 380ms window: animationstart bubbles, and one row animating out is not
  // the claim — every row is. Recorded with the rows still on screen, which is
  // the snapshot doing its job.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __sweeps: number[] }).__sweeps = seen;
    document.addEventListener("animationstart", (e) => {
      if ((e as AnimationEvent).animationName !== "notif-sweep") return;
      seen.push(document.querySelectorAll(".mq-notif .notif-sweep").length);
    });
  });

  const clear = panel.getByRole("button", { name: "Clear" });
  await expect(clear).toBeVisible();
  await clear.click();

  // No second tap: the panel empties itself, and the button never came back to
  // ask. (It also never says "Sure?" — that string is gone from the app.)
  await expect(panel.getByText("You're all caught up.")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Clear|Sure/ })).toHaveCount(0);

  const sweeps = await page.evaluate(() => (window as unknown as { __sweeps: number[] }).__sweeps);
  expect(sweeps.length, "every row animates out").toBe(ROWS);
  expect(Math.max(...sweeps), "the rows are still on screen while they leave").toBe(ROWS);

  const left = await (await rest(`notifications?user_id=eq.${userId}&select=id`)).json();
  expect(left, "the one tap actually deleted them").toEqual([]);
});
