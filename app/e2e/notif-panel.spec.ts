import { test, expect, type Page } from "@playwright/test";

/* The bell panel hangs off the bell at every width.

   It used to be pinned to the viewport's right edge while the bar's controls
   sit in a centred 1280px column, so the wider the screen the further the panel
   drifted from the bell that opened it — a full screen away on an ultrawide,
   and invisible to anyone testing at laptop size. Below 768px it goes back to
   spanning the bar's width, because there the bell is not the last control and
   hanging off it would push the panel off the left edge.

   Needs the local stack (`supabase start`) and an app under test pointing at it
   — app/.env.local may point at the hosted project, so use the "app-local"
   launch config:

     E2E_BASE_URL=http://localhost:4324 npx playwright test e2e/notif-panel.spec.ts */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

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

const SIZES = [
  { label: "ultrawide", width: 3440, height: 1440 },
  { label: "laptop", width: 1440, height: 900 },
  { label: "phone", width: 375, height: 812 },
];

for (const { label, width, height } of SIZES) {
  test(`notification panel opens under the bell — ${label}`, async ({ page }) => {
    await authenticate(page);
    await page.setViewportSize({ width, height });
    await page.goto("/tonight");

    const bell = page.getByRole("button", { name: "Notifications" });
    await bell.click();
    const panel = page.locator(".mq-notif");
    await expect(panel).toBeVisible();
    await page.waitForTimeout(500); // the `rise` animation ends before measuring

    const panelBox = (await panel.boundingBox())!;
    const bellBox = (await bell.boundingBox())!;

    // Wide: flush with the bell. Narrow: the bar's width, which is the shape a
    // phone wants — either way, never off-screen and never far from the bell.
    if (width >= 768) {
      expect(Math.abs((bellBox.x + bellBox.width) - (panelBox.x + panelBox.width))).toBeLessThanOrEqual(1);
    }
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    expect(panelBox.y - (bellBox.y + bellBox.height)).toBeLessThanOrEqual(24);

    // Tapping away dismisses it — including over the floating bottom nav, which
    // sits above the page and would otherwise swallow the tap.
    await page.mouse.click(Math.round(width / 2), height - 40);
    await expect(panel).toHaveCount(0);
  });
}
