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
  // Target the palette by its aria-label, which is a plain literal. The
  // placeholder goes through tr() and was reworded in 1e7f2f4 without the
  // test noticing, since CI had never got this far.
  const search = page.getByRole("dialog", { name: "Search shows" }).getByRole("textbox");
  await expect(search).toBeVisible();
  await search.fill("severance");
  const severanceRow = page.locator(".mq-pal-row", { hasText: "Severance" }).first();
  await expect(severanceRow).toBeVisible({ timeout: 20_000 });
  await severanceRow.click();

  // Detail sheet
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Severance" })).toBeVisible();

  // Ensure followed. One button carries both labels, so bind to it and read the
  // label rather than to "Add", which is a substring match: every cast member is
  // a role="button" too, and "Rachel Addington" answers to it. Once the cast
  // rail lands and this button says Remove, an "Add" locator has only the cast
  // card left to match — clicking it navigates the app to a person page and the
  // sheet, and the rest of this test, is gone.
  const followBtn = dialog.getByRole("button", { name: /^(Add|Remove)$/ });
  await expect(followBtn).toBeVisible();
  if ((await followBtn.textContent())?.trim() === "Add") await followBtn.click();
  await expect(followBtn).toHaveText("Remove");

  // Rate it 8/10 (4th star)
  const starScores = dialog.locator(".rating-half.right");
  await starScores.nth(3).click();
  await expect(dialog.getByText("8/10")).toBeVisible();

  // Exercise an episode write in whichever continuation season opens. Keep the
  // smoke idempotent when the local DB retains state from an earlier run.
  // Unaired rows have a disabled check, so only aired ones are clickable.
  const epRows = dialog.locator(".ep-row:not(.ep-unaired)");
  await expect(epRows.first()).toBeVisible();
  const epCheck = (i: number) => epRows.nth(i).locator(".check");
  /** Leave the episode unwatched, whatever an earlier run left behind. */
  const clearCheck = async (i: number) => {
    const check = epCheck(i);
    if (await check.evaluate((node) => node.classList.contains("on"))) {
      await check.click();
      await expect(check).not.toHaveClass(/\bon\b/);
    }
  };

  // Toggle one episode. Since ef885f7 the check is the only watched toggle —
  // the rest of the row opens the episode sub-sheet.
  await clearCheck(0);
  await epCheck(0).click();
  await expect(epCheck(0)).toHaveClass(/\bon\b/);

  // Mark-up-to, which still hangs off the check: clear the first episode again
  // so a later one is guaranteed an unseen prior, rather than leaving the
  // prompt to whatever the DB already had marked.
  await clearCheck(0);
  const target = Math.min(3, (await epRows.count()) - 1);
  expect(target, "the open season needs a second aired episode").toBeGreaterThan(0);
  await clearCheck(target);
  await epCheck(target).click();
  const confirm = page.getByText("Mark earlier episodes as seen?");
  await expect(confirm).toBeVisible();
  await page.getByRole("button", { name: /Mark all/ }).click();
  await expect(confirm).toHaveCount(0);
  await expect(epCheck(0)).toHaveClass(/\bon\b/);
  await expect(epCheck(target)).toHaveClass(/\bon\b/);

  // The row body opens the episode sub-sheet: a second dialog over the detail
  // sheet, which Escape closes one layer at a time. Bind to the class — the
  // accessible name goes through tr() and would move with the wording.
  await epRows.nth(1).locator(".ep-main").click();
  const epSheet = page.locator(".ep-sheet");
  await expect(epSheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(epSheet).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // Close the sheet
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Calendar renders a feed
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page).toHaveURL(/\/calendar/);

  // You shows the rating we just made
  // The profile is not a nav link but an avatar button, and its accessible
  // name is the user's initial (the text content wins over the title
  // attribute), so it depends on the seeded user. Bind to the class.
  await page.locator(".mq-avatar").click();
  await expect(page.getByRole("heading", { name: "Your ratings" })).toBeVisible();
  await expect(page.locator(".mq-row", { hasText: "Severance" }).first()).toBeVisible();
});
