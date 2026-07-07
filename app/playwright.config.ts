import { defineConfig, devices } from "@playwright/test";

/* E2E smoke — runs against the local Vite dev server + local Supabase stack.
   Requires: `supabase start` and the tmdb-proxy edge function served
   (`supabase functions serve tmdb-proxy --env-file supabase/.env`) with a
   seeded, password-enabled test user. See e2e/README notes in the spec. */

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4321",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 4321 --strictPort",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
