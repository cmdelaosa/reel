/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.PORT) || 4321,
    host: true,
    strictPort: false,
    fs: {
      /* watchProviders.mirror.test.ts imports the two edge functions as `?raw`
         text to assert they still mirror the spec in app/src/domain. They sit
         above this root, so the allow-list has to be widened — but only to
         supabase/functions, never to `..`: this server binds on host:true, and
         the repo root holds app/.env.local and supabase/.env. Edge function
         source is already public in the repo; the secrets stay out of reach. */
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../supabase/functions", import.meta.url)),
      ],
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"], // e2e/ is Playwright, not vitest
    /* Placeholders, so importing lib/supabase.ts is never what decides whether a
       suite runs. It throws at import without these, which made any test that
       reached it — directly or through a lib/ module, as notificationPrefs.test
       does — pass locally off the developer's .env.local and fail on CI, where
       no .env.local exists.

       Pinned rather than borrowed: these override .env.local, so a unit test can
       never point a client at the real project. Nothing here talks to the
       network — the specs that do are Playwright's, against the local stack. */
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
