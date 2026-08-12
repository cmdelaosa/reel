/** The staleness gate that decides which followed titles a run touches.
 *
 *  Extracted from index.ts for the same reason as tmdb-proxy/rank.ts: it is the
 *  part with rules worth pinning down, and index.ts can't be imported by a test
 *  without standing up a server.
 *
 *  It reads `episodes_refreshed_at`, NOT `last_refreshed_at`. The two are
 *  different facts and only one of them is this job's business — see
 *  migration 0066. Reading the wrong one is not a hypothetical: it is the bug
 *  that made this file exist, and the test next door encodes it.
 */

/** Episodes and air times still move on a running show; a daily schedule with a
 *  20h gate self-heals (a run that overruns its wall guard leaves the rest stale
 *  for the next one) without re-fetching what it just fetched. */
export const STALE_MS = 20 * 60 * 60 * 1000; // 20h

/** Ended/Canceled shows never gain episodes, so touch them at most monthly
 *  instead of every daily run — that removes the bulk of a mature library's
 *  TMDB calls and keeps the daily budget for shows that actually change. */
export const ENDED_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export const isDone = (status: string | null | undefined) =>
  status === "Ended" || status === "Canceled";

export type FreshnessRow = {
  status?: string | null;
  episodes_refreshed_at?: string | null;
};

/** Null (or unparseable) counts as infinitely stale: a title whose episodes
 *  were never fetched is the most urgent one there is, and migration 0066 nulls
 *  the column deliberately to queue a title for the next run. */
export const episodeAgeMs = (row: FreshnessRow, now: number): number => {
  if (!row.episodes_refreshed_at) return Infinity;
  const at = new Date(row.episodes_refreshed_at).getTime();
  return Number.isNaN(at) ? Infinity : now - at;
};

export const needsEpisodeRefresh = (row: FreshnessRow, now: number): boolean =>
  episodeAgeMs(row, now) > (isDone(row.status) ? ENDED_STALE_MS : STALE_MS);
