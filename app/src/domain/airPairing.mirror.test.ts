import { describe, expect, it } from "vitest";
import specSource from "@/domain/airPairing.ts?raw";
import proxySource from "../../../supabase/functions/tmdb-proxy/index.ts?raw";
import cronSource from "../../../supabase/functions/episode-refresh/index.ts?raw";

/* airPairing.ts is the canonical spec; the two edge functions hand-mirror it
   because they run in Deno and can't import from app/ (see watchProviders for
   the same arrangement, and the reasoning behind it).

   This rule decides what `air_datetime` holds, and that column drives the alert
   window, the aired / mark-up-to / up-next gates and the whole calendar — a copy
   drifting from the spec doesn't render slightly differently, it dates episodes
   differently depending on whether you opened the show (tmdb-proxy) or waited
   for the nightly job (episode-refresh). Getting that wrong is exactly how the
   Hot Ones season 30 dates broke.

   So the block is compared VERBATIM rather than rule by rule: nothing about it
   is worth paraphrasing in a mirror, and byte equality is the cheapest possible
   check to keep honest. Both copies are spliced between the same two markers,
   `export` included, so the text matches exactly. */

const SPEC = "app/src/domain/airPairing.ts";
const MIRRORS = [
  "supabase/functions/tmdb-proxy/index.ts",
  "supabase/functions/episode-refresh/index.ts",
];

const sources: Record<string, string> = {
  [SPEC]: specSource,
  [MIRRORS[0]]: proxySource,
  [MIRRORS[1]]: cronSource,
};

const OPEN = "// ── air-time pairing ";
const CLOSE = "// ── end air-time pairing ";

/** The marked block, trailing whitespace normalised (editors differ, intent
 *  doesn't). Throws rather than returning empty, so a moved or renamed marker
 *  fails loudly instead of comparing nothing to nothing. */
function block(src: string, file: string): string {
  const from = src.indexOf(OPEN);
  const to = src.indexOf(CLOSE);
  if (from === -1 || to === -1 || to < from) throw new Error(`air-time pairing markers not found in ${file}`);
  return src
    .slice(from, src.indexOf("\n", to) + 1)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
}

describe("the edge functions mirror the air-pairing spec", () => {
  it.each(MIRRORS)("%s carries the block byte for byte", (mirror) => {
    expect(block(sources[mirror], mirror)).toBe(block(sources[SPEC], SPEC));
  });

  it.each(MIRRORS)("%s pairs on the day, never on the number alone", (mirror) => {
    // The regression in one line: a mirror that reintroduced a number-only
    // lookup would still pass the byte check only if it edited the block, which
    // this catches from the other side — the old `stamps.get(...)` shape is gone
    // from the ingest paths for good.
    const code = sources[mirror].replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(code).not.toMatch(/stamps\.get\(/);
    expect(code).toMatch(/resolveAirTime\(/);
  });

  it.each(MIRRORS)("%s never lets a failed TVmaze read demote a clock", (mirror) => {
    // resolveAirTime answers for every anchored row, demotion included. An empty
    // index used to short-circuit the whole pass; since 0065 the pass still runs
    // (a platform rule needs no TVmaze at all), so the guard moved inside the
    // loop and covers exactly the rows TVmaze had dated.
    expect(sources[mirror]).toMatch(/if \(!idx\.size && e\.air_time_source === "tvmaze"\) continue;/);
  });

  it.each(MIRRORS)("%s asks the platform table before falling back", (mirror) => {
    // The two ingest paths must agree on which titles get a release rule and on
    // the day it is applied to, or a show would be dated differently depending
    // on whether you opened it or waited for the nightly job.
    //
    // Which platform is asked about is itself part of the spec now: `network`
    // is TMDB's ORIGINAL BROADCASTER, so a mirror that went back to reading it
    // directly would silently stop dating every streaming show whose network is
    // the channel it left (Futurama under FOX, Adults under FX).
    expect(sources[mirror]).toMatch(/const platform = rulePlatform\(title\);/);
    expect(sources[mirror]).not.toMatch(/platformRelease\(title\.network\)/);
    expect(sources[mirror]).toMatch(/realign: alignedSeasons\(eps, idx\)/);
  });

  it.each(MIRRORS)("%s reads the providers column the rule now depends on", (mirror) => {
    // rulePlatform can only fill a gap if the row it is handed carries the
    // column; a select that forgot it would degrade in silence, back to exactly
    // the network-only behaviour this replaced.
    expect(sources[mirror]).toMatch(/select\("id, imdb_id, tvmaze_id, network, providers"\)/);
  });

  it.each(MIRRORS)("%s writes the TMDB day it anchors against", (mirror) => {
    // Without this column the pairing has nothing to judge a stamp by, and a row
    // already carrying a wrong instant could never be re-derived.
    expect(sources[mirror]).toMatch(/air_date: e\.air_date \|\| null,/);
    expect(sources[mirror]).toMatch(/held\.airDate === \(e\.air_date \|\| null\)/);
  });
});
