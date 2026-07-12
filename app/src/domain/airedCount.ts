/* Authoritative count of AIRED regular-season episodes, derived from TMDB's
   title payload (the `/tv/{id}` response) rather than from however many episode
   rows happen to be cached. This is the ground truth that drives status/progress
   (see status.ts) — deriving it from the shared, lazily-filled `episodes` cache
   made counts wrong for un-drilled shows and made them shift when other users
   browsed the shared cache.

   This is the canonical spec. The tmdb-proxy and episode-refresh edge functions
   hand-mirror it (no cross-runtime import), same as they mirror the row shapes. */

export interface AiredSeason {
  season_number: number;
  episode_count: number | null;
}

export interface LastAiredEpisode {
  season_number: number;
  episode_number: number;
}

/** Full episode_count for every regular season before the last-aired one, plus
 *  the last-aired episode number within its season. Specials (season 0) are
 *  excluded. Returns null when it can't be determined (nothing aired yet, or
 *  TMDB gave no last_episode_to_air) so callers fall back to the old count. */
export function computeAiredCount(
  seasons: AiredSeason[],
  lastAired: LastAiredEpisode | null | undefined,
): number | null {
  if (!lastAired || lastAired.season_number <= 0) return null;
  let aired = 0;
  for (const s of seasons) {
    if (s.season_number <= 0) continue; // specials never count
    if (s.season_number < lastAired.season_number) aired += s.episode_count ?? 0;
    else if (s.season_number === lastAired.season_number) aired += lastAired.episode_number;
  }
  return aired;
}
