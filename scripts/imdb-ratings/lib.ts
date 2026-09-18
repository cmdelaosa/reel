/* The one decision in this importer that can be wrong without anything failing:
   given what we already hold and what IMDb now publishes, does this row earn a
   write? Both answers are expensive in opposite directions.

   Say yes too often and the run is 4.7k sequential UPDATEs of rows that did not
   move — that was the whole runtime, and where the Gateway Timeouts came from.
   Say no too often and a rating silently freezes and nothing reports it.

   Kept apart from the network and the database so it can be tested. */

/** What we already hold for a show or an episode. */
export interface Stored {
  imdb_rating: number | null;
  imdb_votes: number | null;
}

/* IMDb publishes one decimal, so anything under half a step is the same score
   arriving again. */
const SAME_SCORE = 0.05;

/* How far the vote count may drift before it is worth a write of its own. The
   count never stops climbing, so it cannot gate a write by mere inequality:
   nothing would ever be skipped. 5% keeps the "N votes on IMDb" tooltip from
   freezing on a show whose score never budges, without writing every run. */
const VOTE_DRIFT = 0.05;

/**
 * A show: written when its score moves, when we hold no score, or when the vote
 * count has drifted far enough to be worth saying.
 *
 * `votes` null means the line's numVotes column was malformed — no news, not
 * news of zero. It must not force a write: the same malformed line arrives every
 * run, so it would reopen the very loop this skip exists to close. (The caller
 * also leaves imdb_votes out of the patch in that case, so a good stored count
 * is never overwritten by the absence of one.)
 */
export function showNeedsWrite(stored: Stored, score: number, votes: number | null): boolean {
  if (stored.imdb_rating == null || Math.abs(stored.imdb_rating - score) >= SAME_SCORE) return true;
  if (votes == null) return false;
  if (stored.imdb_votes == null) return true;
  return Math.abs(stored.imdb_votes - votes) >= stored.imdb_votes * VOTE_DRIFT;
}

/**
 * An episode: written unless the row is ALREADY complete at this score.
 *
 * Votes do not open a write here — an episode's count settles early and there
 * are ~40k of them. But a missing count does: matching on the score alone once
 * stranded 11258 episodes that OMDb had filled without a vote count. Their
 * score matched, so the row was never touched again and its votes stayed null
 * forever.
 */
export function episodeNeedsWrite(stored: Stored, score: number): boolean {
  if (stored.imdb_rating == null || stored.imdb_votes == null) return true;
  return Math.abs(stored.imdb_rating - score) >= SAME_SCORE;
}
