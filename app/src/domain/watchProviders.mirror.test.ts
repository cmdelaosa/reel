import { describe, expect, it } from "vitest";
import specSource from "@/domain/watchProviders.ts?raw";
import proxySource from "../../../supabase/functions/tmdb-proxy/index.ts?raw";
import cronSource from "../../../supabase/functions/episode-refresh/index.ts?raw";

/* watchProviders.ts is the canonical spec; the two edge functions hand-mirror
   it because they run in Deno and can't import from app/. That convention is
   the repo's (see airedCount), but this rule set is five interacting pieces
   rather than one, and it drifted twice while being written — a fix landing in
   the spec only would mean the nightly cron and the on-open refresh writing
   differently-shaped rows for the same title, and which one you saw would
   depend on whether you opened the show or waited for the job.

   So: compare source against source. Nothing is duplicated into this file —
   each rule is extracted from all three and required to agree, which means a
   future edit to any one of them fails here until it lands in all three. */

/* Loaded with Vite's `?raw` rather than node's fs: it needs no @types/node in
   the app's tsconfig (which would put NodeJS globals in scope for all of src
   and retype setTimeout), and it fails loudly at import time if a path moves.
   The edge functions sit above the Vite root, so vite.config's test.server.fs
   allow-list reaches the repo root. */

const SPEC = "app/src/domain/watchProviders.ts";
const MIRRORS = [
  "supabase/functions/tmdb-proxy/index.ts",
  "supabase/functions/episode-refresh/index.ts",
];

const sources: Record<string, string> = {
  [SPEC]: specSource,
  [MIRRORS[0]]: proxySource,
  [MIRRORS[1]]: cronSource,
};

/** The alias table's pairs, order-independent. */
function aliases(src: string): string[] {
  const block = /(?:const (?:ALIASES|PROVIDER_ALIASES)): Record<string, string> = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("alias table not found");
  return [...block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)]
    .map((m) => `${m[1]} -> ${m[2]}`)
    .sort();
}

const literal = (src: string, name: string): string => {
  const m = new RegExp(`const ${name} = (/.*/[a-z]*);`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[1];
};

/** The canonicalise body, stripped of the alias-table name that differs. */
const canonicalBody = (src: string): string => {
  const m = /const base = name\.replace\((.*)\)\.replace\((.*)\)\.trim\(\);/.exec(src);
  if (!m) throw new Error("canonicalProvider body not found");
  return `${m[1]}|${m[2]}`;
};

/** The sub-package merge, normalised for the cast the Deno copies carry. */
const mergeRule = (src: string): string => {
  const m = /list\.filter\(\s*\(a\) => !list\.some\(\(b\) => b !== a && a\.name\.startsWith\(`\$\{b\.name\} `\)\),?\s*\)/.exec(src);
  return m ? "present" : "missing";
};

describe("the edge functions mirror the provider spec", () => {
  it.each(MIRRORS)("%s carries the same brand aliases", (mirror) => {
    expect(aliases(sources[mirror])).toEqual(aliases(sources[SPEC]));
  });

  it.each(MIRRORS)("%s carries the same reseller and ad-tier patterns", (mirror) => {
    expect(literal(sources[mirror], "RESELLER")).toBe(literal(sources[SPEC], "RESELLER"));
    expect(literal(sources[mirror], "AD_TIER")).toBe(literal(sources[SPEC], "AD_TIER"));
  });

  it.each(MIRRORS)("%s canonicalises in the same order", (mirror) => {
    // Order matters: RESELLER before AD_TIER, or "Prime Video with Ads Amazon
    // Channel"-shaped names strip only half.
    expect(canonicalBody(sources[mirror])).toBe(canonicalBody(sources[SPEC]));
  });

  it.each(MIRRORS)("%s reads the same buckets and no others", (mirror) => {
    const buckets = /\["flatrate", "free", "ads"\]/;
    expect(sources[mirror]).toMatch(buckets);
    expect(sources[SPEC]).toMatch(buckets);
    // rent/buy may only ever appear in prose explaining why they're dropped.
    const code = sources[mirror].replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(code).not.toMatch(/["']rent["']|["']buy["']/);
  });

  it.each(MIRRORS)("%s still folds sub-packages into their parent", (mirror) => {
    expect(mergeRule(sources[mirror])).toBe("present");
    expect(mergeRule(sources[SPEC])).toBe("present");
  });

  it.each(MIRRORS)("%s dedups on both the name and the artwork", (mirror) => {
    expect(sources[mirror]).toMatch(/seen\.has\(name\) \|\| \(art && seenArt\.has\(art\)\)/);
    expect(sources[SPEC]).toMatch(/seen\.has\(name\) \|\| \(art && seenArt\.has\(art\)\)/);
  });
});
