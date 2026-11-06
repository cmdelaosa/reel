// Pure and dependency-free (unlike lib.ts, which needs fflate), so the Deno
// tests under supabase/functions can import it without an import map.

export interface EpisodeWatch {
  season: number; // TheTVDB numbering, 0 = special
  episode: number;
  watchedAt: string; // ISO
  tvdbEpisodeId?: string;
}

/** Map watches (TheTVDB numbering) onto TMDB episode rows. The number pair is
 *  tried first; on a miss, `lookup` asks TMDB where that TheTVDB episode id
 *  lives (one request per miss, so a show that matches costs nothing extra).
 *  Two watches can land on the same row once renumbered — e.g. a TheTVDB
 *  special that TMDB counts as a regular episode the user also marked — so the
 *  result is keyed by episode row, keeping the earliest watch: one upsert batch
 *  touching a row twice is rejected whole by Postgres. */
export async function matchWatches(
  watches: EpisodeWatch[],
  byPair: Map<string, string>,
  lookup: (tvdbEpisodeId: string) => Promise<string | null>,
): Promise<{ watchedAt: Map<string, string>; unmatched: number }> {
  const watchedAt = new Map<string, string>();
  let unmatched = 0;
  for (const w of watches) {
    let id = w.season > 0 ? byPair.get(`${w.season}:${w.episode}`) : undefined;
    if (!id && w.tvdbEpisodeId) {
      const pair = await lookup(w.tvdbEpisodeId);
      if (pair) id = byPair.get(pair); // byPair holds regular seasons only, so TMDB specials stay out
    }
    if (!id) {
      unmatched++; // TVDB↔TMDB numbering drift TMDB can't bridge; skipped, reported
      continue;
    }
    const prev = watchedAt.get(id);
    if (!prev || w.watchedAt < prev) watchedAt.set(id, w.watchedAt);
  }
  return { watchedAt, unmatched };
}
