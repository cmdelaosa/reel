/* Show status derivation — pure, mirrors the prototype's Status semantics.
   See docs/ARCHITECTURE.md → Core derivations. Specials (season 0) are already
   excluded from the counts by rpc_library_rollup. */

export type ShowStatus = "watching" | "caughtup" | "watchlist" | "upcoming" | "finished";

export interface StatusInput {
  /** Episodes aired to date (specials excluded). */
  airedCount: number;
  /** Episodes the user watched (specials excluded). */
  watchedCount: number;
  /** TMDB title status: "Returning Series" | "Ended" | "Canceled" | … */
  tmdbStatus: string | null;
}

export function deriveStatus({ airedCount, watchedCount, tmdbStatus }: StatusInput): ShowStatus {
  if (airedCount === 0) return "upcoming";
  if (watchedCount === 0) return "watchlist";
  if (watchedCount < airedCount) return "watching";
  // watched everything that's aired
  return tmdbStatus === "Ended" || tmdbStatus === "Canceled" ? "finished" : "caughtup";
}

/** Poster progress % for `watching` shows (0 when not meaningful). */
export function watchProgress({ airedCount, watchedCount }: Pick<StatusInput, "airedCount" | "watchedCount">): number {
  if (airedCount === 0) return 0;
  return Math.round((Math.min(watchedCount, airedCount) / airedCount) * 100);
}
