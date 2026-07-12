import { test, expect, type Page } from "@playwright/test";

/* Core-loop smoke: authenticate (password-grant bypass of the magic-link UI),
   search → add → detail → mark watched → Tonight up-next → Calendar → rate →
   You. Runs against local Supabase + the served tmdb-proxy.

   Env (defaults target the local stack):
     E2E_SUPABASE_URL   default http://127.0.0.1:54321
     E2E_ANON_KEY       default the local publishable key
     E2E_EMAIL/PASSWORD default cmo@example.com / password123 (seeded user) */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
// supabase-js localStorage key: sb-<first hostname label>-auth-token.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Sign in via the auth API and inject the session so the app boots authed. */
async function authenticate(page: Page) {
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
}

test("core loop: search → add → mark watched → tonight → calendar → rate → you", async ({ page }) => {
  await authenticate(page);
  await page.goto("/tonight");
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();

  // ⌘K search
  await page.keyboard.press("Meta+k");
  const search = page.getByPlaceholder(/Search shows/i);
  await expect(search).toBeVisible();
  await search.fill("severance");
  const severanceRow = page.locator(".mq-pal-row", { hasText: "Severance" }).first();
  await expect(severanceRow).toBeVisible({ timeout: 20_000 });
  await severanceRow.click();

  // Detail sheet
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Severance" })).toBeVisible();

  // Ensure followed (Add if not already)
  const removeBtn = dialog.getByRole("button", { name: "Remove" });
  const addBtn = dialog.getByRole("button", { name: "Add" });
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click();
    await expect(removeBtn).toBeVisible();
  }

  // Rate it 8/10 (4th star)
  const starScores = dialog.locator(".rating-half.right");
  await starScores.nth(3).click();
  await expect(dialog.getByText("8/10")).toBeVisible();

  // Exercise an episode write in whichever continuation season opens. Keep the
  // smoke idempotent when the local DB retains state from an earlier run.
  const epRows = dialog.locator(".ep-row");
  await expect(epRows.first()).toBeVisible();
  const firstCheck = epRows.first().locator(".check");
  if (await firstCheck.evaluate((node) => node.classList.contains("on"))) {
    await firstCheck.click();
    await expect(firstCheck).not.toHaveClass(/\bon\b/);
  }
  await firstCheck.click();
  await expect(epRows.first().locator(".check.on")).toBeVisible();

  // Mark-up-to on a later episode → confirm dialog → Mark all
  await epRows.nth(3).click();
  const confirm = page.getByText("Mark earlier episodes as seen?");
  if (await confirm.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Mark all/ }).click();
  }

  // Close the sheet
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Calendar renders a feed
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page).toHaveURL(/\/calendar/);

  // You shows the rating we just made
  await page.getByRole("link", { name: "You" }).first().click();
  await expect(page.getByRole("heading", { name: "Your ratings" })).toBeVisible();
  await expect(page.locator(".mq-row", { hasText: "Severance" }).first()).toBeVisible();
});
