// Discovery re-rankers for tmdb-proxy: the rules that decide what order the
// Explore grids come back in. They live here rather than in index.ts because
// index.ts calls Deno.serve at import time — anything defined in there can't be
// imported by a test without starting a server. Pure and dependency-free, so
// rank_test.ts can exercise them directly (`deno test`, run in CI).
//
// All of them take and return the same rows: they only re-order. A re-ranker that
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

// ── La nota de IMDb manda en los órdenes por nota ──────────────────────────
// TMDB ordena /discover por SU nota (`sort_by=vote_average.desc`), y la app
// enseña la de IMDb, con la de TMDB solo de reserva (app/src/domain/
// externalScore.ts). Sin esto, «Mejor valoradas» y las colecciones pintaban un
// número y ordenaban por otro: un 8,4 de IMDb debajo de un 8,1.
//
// La nota de IMDb no viene en el payload de TMDB: vive en nuestra tabla
// `titles` (scripts/imdb-ratings), así que quien llama pasa el mapa
// tmdb_id → imdb_rating que devuelve el upsert. Va ANTES de capNonWestern:
// ese tope reparte huecos sobre el orden que recibe, y reordenar después lo
// desharía.
//
// La regla es la de externalScore: IMDb si es un número > 0, TMDB si no, y lo
// que no tiene ninguna al final. Ordenación estable: los empates, y todo lo que
// no tiene nota, conservan el orden en que TMDB los dio.
type ScoredRow = { id: number; vote_average?: number | null };

export const byImdbFirst = <T extends ScoredRow>(
  rows: T[],
  imdb: ReadonlyMap<number, number | null | undefined>,
): T[] => {
  const rated = (n: number | null | undefined): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  const score = (r: T): number | null => {
    const i = imdb.get(r.id);
    if (rated(i)) return i;
    return rated(r.vote_average) ? r.vote_average : null;
  };
  return rows
    .map((r, pos) => ({ r, pos, s: score(r) }))
    .sort((a, b) => {
      if (a.s === null || b.s === null) {
        if (a.s === b.s) return a.pos - b.pos;
        return a.s === null ? 1 : -1;
      }
      return b.s - a.s || a.pos - b.pos;
    })
    .map((x) => x.r);
};

/** El mapa tmdb_id → imdb_rating a partir de las filas que devuelve el upsert
 *  de `titles`. Las filas son las de la base, que es donde está la nota. */
export const imdbByTmdbId = (saved: { tmdb_id: number; imdb_rating?: number | null }[]) =>
  new Map(saved.map((r) => [r.tmdb_id, r.imdb_rating ?? null]));
