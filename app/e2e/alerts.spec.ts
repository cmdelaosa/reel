import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/* New-episode alert rule (migration 0059) — which shows are allowed to notify.
   The rule lives in SQL (pending_new_episode_alerts) while the statuses it
   mirrors live in app/src/domain/status.ts, so nothing type-checks the two
   against each other: this spec is what holds them together.

   Each case seeds one show in a known bucket, airs an episode an hour ago, and
   asserts whether the RPC offers it. The buckets are judged as they were
   *before* that episode aired — see the migration's header for why a premiere
   would otherwise be swallowed.

   Runs in the nightly/dispatch e2e job (local Supabase stack); needs the
   service-role key, since the RPC and its ledger are service-role only.

   Env (CI sets these; defaults target the local stack):
     E2E_SUPABASE_URL          default http://127.0.0.1:54321
     E2E_ANON_KEY              anon/publishable key
     E2E_SERVICE_ROLE_KEY      service-role key (seeds + calls the RPC)
     E2E_EMAIL / E2E_PASSWORD  the seeded invited user */

const URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.E2E_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

/** tmdb_ids are fixed per bucket so a re-run overwrites its own fixtures. */
const BASE_TMDB = 3999100;

type Bucket = "watching" | "caughtup" | "upcoming" | "watchlist" | "finished" | "stopped";

interface Case {
  bucket: Bucket;
  /** Episodes that aired BEFORE the new one. */
  priorEpisodes: number;
  /** How many of those the user watched. */
  watched: number;
  tmdbStatus: string;
  stopped: boolean;
  /** Should the freshly aired episode produce an alert? */
  expectAlert: boolean;
}

const CASES: Case[] = [
  // Started it, still behind → the ordinary case.
  { bucket: "watching", priorEpisodes: 5, watched: 3, tmdbStatus: "Returning Series", stopped: false, expectAlert: true },
  // Seen everything that had aired, show still running.
  { bucket: "caughtup", priorEpisodes: 5, watched: 5, tmdbStatus: "Returning Series", stopped: false, expectAlert: true },
  // Nothing had aired yet: this episode IS the premiere.
  { bucket: "upcoming", priorEpisodes: 0, watched: 0, tmdbStatus: "Returning Series", stopped: false, expectAlert: true },
  // Followed but never started — the backlog that used to shout.
  { bucket: "watchlist", priorEpisodes: 5, watched: 0, tmdbStatus: "Returning Series", stopped: false, expectAlert: false },
  // Ended and fully watched. A new episode means a revival, which the app
  // itself re-labels `watching`, so it is allowed through.
  { bucket: "finished", priorEpisodes: 5, watched: 5, tmdbStatus: "Ended", stopped: false, expectAlert: true },
  // Explicitly stopped — 0022 always claimed this silenced alerts.
  { bucket: "stopped", priorEpisodes: 5, watched: 3, tmdbStatus: "Returning Series", stopped: true, expectAlert: false },
];

test("new-episode alerts follow the show's status", async () => {
  expect(SERVICE, "E2E_SERVICE_ROLE_KEY must be set for the alerts test").not.toEqual("");
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Identify the seeded user the same way the other specs do.
  const grant = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(grant.ok, `password grant for ${EMAIL} — is the dev seed loaded?`).toBeTruthy();
  const userId: string = (await grant.json()).user.id;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  /** Prior episodes are spread backwards so "aired before this one" is unambiguous. */
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  const freshByBucket = new Map<Bucket, string>();

  for (const [i, c] of CASES.entries()) {
    const tmdbId = BASE_TMDB + i;
    const { data: title, error: tErr } = await admin
      .from("titles")
      .upsert({ tmdb_id: tmdbId, kind: "tv", name: `Alert ${c.bucket}`, status: c.tmdbStatus }, { onConflict: "tmdb_id" })
      .select("id").single();
    expect(tErr, `seed title ${c.bucket}: ${tErr?.message}`).toBeNull();
    const titleId = title!.id as string;

    // Clean slate: this fixture's episodes, watches, library row and ledger.
    const { data: old } = await admin.from("episodes").select("id").eq("title_id", titleId);
    const oldIds = (old ?? []).map((e) => e.id as string);
    if (oldIds.length) {
      await admin.from("watch_events").delete().in("episode_id", oldIds);
      await admin.from("notifications_sent").delete().in("episode_id", oldIds);
      await admin.from("episodes").delete().in("id", oldIds);
    }
    await admin.from("library_entries").delete().eq("user_id", userId).eq("title_id", titleId);

    // Prior episodes (E1…En), then the fresh one an hour ago.
    const rows = Array.from({ length: c.priorEpisodes }, (_, n) => ({
      title_id: titleId, season_number: 1, episode_number: n + 1,
      name: `Prior ${n + 1}`, air_datetime: daysAgo(c.priorEpisodes - n + 1),
    }));
    rows.push({
      title_id: titleId, season_number: 1, episode_number: c.priorEpisodes + 1,
      name: "Fresh", air_datetime: hourAgo,
    });
    const { data: eps, error: eErr } = await admin.from("episodes").insert(rows).select("id, episode_number");
    expect(eErr, `seed episodes ${c.bucket}: ${eErr?.message}`).toBeNull();

    const sorted = (eps ?? []).sort((a, b) => (a.episode_number as number) - (b.episode_number as number));
    freshByBucket.set(c.bucket, sorted[sorted.length - 1].id as string);

    if (c.watched > 0) {
      await admin.from("watch_events").insert(
        sorted.slice(0, c.watched).map((e) => ({ user_id: userId, episode_id: e.id as string })),
      );
    }
    const { error: lErr } = await admin.from("library_entries")
      .insert({ user_id: userId, title_id: titleId, followed: true, stopped: c.stopped });
    expect(lErr, `seed library ${c.bucket}: ${lErr?.message}`).toBeNull();
  }

  const { data: pending, error: rErr } = await admin.rpc("pending_new_episode_alerts");
  expect(rErr, `call pending_new_episode_alerts: ${rErr?.message}`).toBeNull();
  const offered = new Set(
    (pending ?? []).filter((r: { user_id: string }) => r.user_id === userId).map((r: { episode_id: string }) => r.episode_id),
  );

  for (const c of CASES) {
    const episodeId = freshByBucket.get(c.bucket)!;
    expect(
      offered.has(episodeId),
      `${c.bucket}: expected ${c.expectAlert ? "an alert" : "silence"}`,
    ).toBe(c.expectAlert);
  }
});
