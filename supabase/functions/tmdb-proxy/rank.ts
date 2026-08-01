// Discovery re-rankers for tmdb-proxy: the two rules that decide what order the
// Explore grids come back in. They live here rather than in index.ts because
// index.ts calls Deno.serve at import time — anything defined in there can't be
// imported by a test without starting a server. Pure and dependency-free, so
// rank_test.ts can exercise them directly (`deno test`, run in CI).
//
// Both take and return the same rows: they only re-order. A re-ranker that
// drops rows empties grids for narrow filters, which is exactly the bug both of
// these shipped with — see the drain loops below and their tests.

/** The fields each re-ranker reads. Rows are TMDB payloads; everything else is ignored. */
type LangRow = { original_language?: string | null };
type OriginRow = { origin_country?: string[] | null };

// East/Southeast Asian dramas dominate TMDB's global popularity, but discovery
// here should be overwhelmingly Western — so beyond the hard hides in index.ts,
// non-Western titles are capped rather than hidden. "Western" is judged by
// original language: any European language qualifies (Latin America included
// via es/pt); everything else (ko, ja, zh, th…) competes for the capped slots.
// Search by name is unaffected.
export const WESTERN_LANGS = new Set([
  "en", "es", "pt", "fr", "de", "it", "nl", "sv", "da", "no", "nb", "nn", "fi",
  "is", "pl", "cs", "sk", "hu", "ro", "bg", "el", "uk", "hr", "sr", "bs",
  "sl", "mk", "sq", "et", "lv", "lt", "be", "ga", "cy", "ca", "eu", "gl", "mt",
]);
export const NON_WESTERN_MAX = 0.1; // at most 1 slot in 10

/**
 * Re-ranks a list so non-Western titles fill at most NON_WESTERN_MAX of every
 * prefix: Western titles keep their order, and the best-ranked non-Western ones
 * are demoted into slots 10, 20, 30… (not dropped — a #1 global hit still
 * shows, just below the Western top 9). The prefix property means truncating
 * the result anywhere preserves the ratio, for as long as Western supply lasts.
 */
export const capNonWestern = <T extends LangRow>(rows: T[]): T[] => {
  const isWestern = (r: T) => WESTERN_LANGS.has(r?.original_language ?? "");
  const western = rows.filter(isWestern);
  const rest = rows.filter((r) => !isWestern(r));
  const out: T[] = [];
  let w = 0, n = 0;
  while (w < western.length) {
    if (n < rest.length && n + 1 <= (out.length + 1) * NON_WESTERN_MAX) out.push(rest[n++]);
    else out.push(western[w++]);
  }
  // Western supply exhausted — nothing left to space the remaining non-Western
  // titles against, so they keep their order at the tail. Only reachable once
  // the cap has already placed every Western row, which is exactly when a
  // Western-only tail is impossible to build. Without this the leftovers were
  // dropped: a pool with no Western titles returned nothing at all.
  while (n < rest.length) out.push(rest[n++]);
  return out;
};

// Spain-origin shows get a guaranteed *floor* (the mirror of the cap above):
// the discover-grid routes fetch extra with_origin_country=ES pages so the pool
// has Spanish supply, and this re-rank promotes the best-ranked Spanish titles
// into slots 6, 12, 18… (~1 in 6), supply permitting. Judged by TMDB's
// origin_country (present on both discover and detail payloads) — language
// won't do, it can't tell Spain from Latin America. Trending and the curated
// collections are left honest.
// ORDER MATTERS: always boost first, cap last — capNonWestern's per-prefix
// guarantee only holds for the list it emits. Boosting afterwards pulls the
// (Western) Spanish rows out of the tail, leaving a tail that over-fills with
// the non-Western titles the cap had spaced out against them.
export const SPANISH_MIN = 1 / 6;
export const isSpanish = (r: OriginRow) => ((r?.origin_country ?? []) as string[]).includes("ES");

export const boostSpanish = <T extends OriginRow>(rows: T[]): T[] => {
  const spanish = rows.filter(isSpanish);
  const rest = rows.filter((r) => !isSpanish(r));
  const out: T[] = [];
  let s = 0, o = 0;
  while (o < rest.length) {
    if (s < spanish.length && s + 1 <= Math.floor((out.length + 1) * SPANISH_MIN)) out.push(spanish[s++]);
    else out.push(rest[o++]);
  }
  // Non-Spanish supply exhausted: the floor is a minimum, never a licence to
  // discard the surplus. Same drain as the cap above — without it an unusually
  // Spanish-heavy pool lost the excess (and an all-Spanish one came back empty).
  while (s < spanish.length) out.push(spanish[s++]);
  return out;
};
