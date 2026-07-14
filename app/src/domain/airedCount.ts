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

export interface UpcomingSeasonInput {
  season_number: number;
  /** Season-level premiere date 'YYYY-MM-DD', or null when TMDB hasn't dated it. */
  air_date: string | null;
}

export interface UpcomingSeason {
  number: number;
  air_date: string | null;
}

/** The next announced season *beyond* the last-aired one — the authoritative
 *  signal that a show the user already started is "returning". Returns the
 *  lowest-numbered season after the last-aired season with its season-level
 *  air_date (which may be null = announced, no date yet). Returns null when:
 *  nothing has aired (that's a *new* show, not a returning one), or no season
 *  exists past the last-aired one (a mid-season show — its next episode is
 *  dated, so callers rely on next_air_datetime instead). Specials (season 0)
 *  are ignored.
 *
 *  Like computeAiredCount this is the canonical spec; the tmdb-proxy and
 *  episode-refresh edge functions hand-mirror it — keep in sync. */
export function computeUpcomingSeason(
  seasons: UpcomingSeasonInput[],
  lastAired: LastAiredEpisode | null | undefined,
): UpcomingSeason | null {
  if (!lastAired || lastAired.season_number <= 0) return null;
  let best: UpcomingSeason | null = null;
  for (const s of seasons) {
    if (s.season_number <= lastAired.season_number) continue; // specials + already-aired/airing
    if (!best || s.season_number < best.number) best = { number: s.season_number, air_date: s.air_date ?? null };
  }
  return best;
}
