// Unit tests for the episode staleness gate. Run by CI's `edge` job (`deno test`).
//
// The first case is the regression this module was extracted for: the gate used
// to read `last_refreshed_at`, which the discovery warm-up (04:40 UTC) also
// writes when it resolves the popular-now pool. Twenty minutes later this run
// read that stamp back and skipped the title as fresh — every day, for as long
// as the show stayed in the pool. Silo and Ted Lasso went unrefreshed for weeks
// that way. A row carrying a fresh `last_refreshed_at` and a stale
// `episodes_refreshed_at` is exactly the shape the bug had, so it is the shape
// the gate is tested against.
import { assertEquals } from "jsr:@std/assert@1";
import { ENDED_STALE_MS, needsEpisodeRefresh, STALE_MS } from "./stale.ts";

const NOW = Date.parse("2026-08-12T05:00:00Z");
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3600_000;

Deno.test("a title the discovery warm-up just wrote is still due an episode refresh", () => {
  const row = {
    status: "Returning Series",
    // What discover-warm stamped 20 minutes ago. The gate must not see it.
    last_refreshed_at: agoMs(20 * 60_000),
    episodes_refreshed_at: agoMs(21 * HOUR),
  };
  assertEquals(needsEpisodeRefresh(row, NOW), true);
});

Deno.test("never-refreshed episodes are infinitely stale, whatever the status", () => {
  for (const status of ["Returning Series", "Ended", "Canceled", null]) {
    assertEquals(needsEpisodeRefresh({ status, episodes_refreshed_at: null }, NOW), true, `${status}`);
  }
});

Deno.test("a running show is fresh under 20h and stale over it", () => {
  const status = "Returning Series";
  assertEquals(needsEpisodeRefresh({ status, episodes_refreshed_at: agoMs(STALE_MS - HOUR) }, NOW), false);
  assertEquals(needsEpisodeRefresh({ status, episodes_refreshed_at: agoMs(STALE_MS + HOUR) }, NOW), true);
});

Deno.test("Ended and Canceled shows are touched monthly, not daily", () => {
  const DAY = 24 * HOUR;
  for (const status of ["Ended", "Canceled"]) {
    // A day old: due for a running show, far too soon for one that is over.
    assertEquals(needsEpisodeRefresh({ status, episodes_refreshed_at: agoMs(DAY) }, NOW), false, `${status} @1d`);
    assertEquals(
      needsEpisodeRefresh({ status, episodes_refreshed_at: agoMs(ENDED_STALE_MS + DAY) }, NOW),
      true,
      `${status} @31d`,
    );
  }
});

Deno.test("an unparseable stamp is treated as never refreshed, not as fresh", () => {
  assertEquals(needsEpisodeRefresh({ status: "Returning Series", episodes_refreshed_at: "not a date" }, NOW), true);
});
