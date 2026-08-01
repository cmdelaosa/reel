// Unit tests for the discovery re-rankers. Run by CI's `edge` job (`deno test`).
//
// Both rules shipped the same bug — a loop that ran only while one side's supply
// lasted, silently discarding the other side's leftovers — so the invariant
// every case here checks first is that *no row is ever lost*. The ordering
// properties (≤1-in-10 non-Western, ≥1-in-6 Spanish) are the point of the rules;
// the conservation property is what keeps a narrow filter from emptying a grid.
import { assertEquals } from "jsr:@std/assert@1";
import { boostSpanish, capNonWestern } from "./rank.ts";

const tv = (id: number, original_language: string) => ({ id, original_language });
const es = (id: number) => ({ id, origin_country: ["ES"] });
const other = (id: number) => ({ id, origin_country: ["US"] });
const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

/** Same multiset in, same multiset out — the property both rules broke. */
const assertConserves = <T extends { id: number }>(input: T[], output: T[]) => {
  assertEquals(output.length, input.length, "row count changed");
  assertEquals([...ids(output)].sort((a, b) => a - b), [...ids(input)].sort((a, b) => a - b));
};

Deno.test("capNonWestern keeps Western titles in their original order", () => {
  const rows = [...Array.from({ length: 30 }, (_, i) => tv(i, "en")),
                ...Array.from({ length: 10 }, (_, i) => tv(100 + i, "ko"))];
  const out = capNonWestern(rows);
  assertEquals(ids(out.filter((r) => r.original_language === "en")),
               Array.from({ length: 30 }, (_, i) => i));
});

Deno.test("capNonWestern holds ≤1-in-10 in every prefix while Western supply lasts", () => {
  const rows = [...Array.from({ length: 100 }, (_, i) => tv(i, "en")),
                ...Array.from({ length: 30 }, (_, i) => tv(1000 + i, "ja"))];
  const out = capNonWestern(rows);
  for (let k = 1; k <= 100; k++) {
    const nonWestern = out.slice(0, k).filter((r) => r.original_language === "ja").length;
    assertEquals(nonWestern <= Math.ceil(k * 0.1), true, `prefix of ${k} holds ${nonWestern}`);
  }
});

Deno.test("capNonWestern returns every row it was given", () => {
  // Regression: the interleave used to stop with the Western supply, so a
  // Western-rich pool still lost the non-Western tail it never placed.
  const rows = [...Array.from({ length: 100 }, (_, i) => tv(i, "en")),
                ...Array.from({ length: 30 }, (_, i) => tv(1000 + i, "ja"))];
  assertConserves(rows, capNonWestern(rows));
});

Deno.test("capNonWestern passes a pool with no Western titles straight through", () => {
  // Regression: this returned [] — the case that emptied narrow Explore filters.
  const rows = Array.from({ length: 20 }, (_, i) => tv(i, "ko"));
  const out = capNonWestern(rows);
  assertConserves(rows, out);
  assertEquals(ids(out), ids(rows), "order should be untouched when there is nothing to space");
});

Deno.test("capNonWestern treats an absent language as non-Western without losing the row", () => {
  const rows = [{ id: 1 }, tv(2, "en"), { id: 3, original_language: null }];
  assertConserves(rows, capNonWestern(rows));
});

Deno.test("capNonWestern handles an empty list", () => {
  assertEquals(capNonWestern([]), []);
});

Deno.test("boostSpanish lifts Spanish titles to roughly 1 in 6", () => {
  const rows = [...Array.from({ length: 10 }, (_, i) => es(i)),
                ...Array.from({ length: 60 }, (_, i) => other(100 + i))];
  const out = boostSpanish(rows);
  // The floor is a minimum over the interleaved run, not an exact rate.
  assertEquals(out.slice(0, 12).filter((r) => r.origin_country[0] === "ES").length >= 2, true);
  assertEquals(ids(out.filter((r) => r.origin_country[0] === "ES")).slice(0, 3), [0, 1, 2],
    "the best-ranked Spanish titles are the ones promoted");
});

Deno.test("boostSpanish returns every row when Spanish supply is abundant", () => {
  // Regression: with 40 ES rows against 60 others this dropped 29 of them —
  // the floor is a minimum, not a licence to discard the surplus.
  const rows = [...Array.from({ length: 40 }, (_, i) => es(i)),
                ...Array.from({ length: 60 }, (_, i) => other(100 + i))];
  assertConserves(rows, boostSpanish(rows));
});

Deno.test("boostSpanish passes an all-Spanish pool straight through", () => {
  // Regression: this returned [].
  const rows = Array.from({ length: 20 }, (_, i) => es(i));
  assertEquals(ids(boostSpanish(rows)), ids(rows));
});

Deno.test("boostSpanish leaves a pool with no Spanish titles untouched", () => {
  const rows = Array.from({ length: 15 }, (_, i) => other(i));
  assertEquals(ids(boostSpanish(rows)), ids(rows));
});

Deno.test("boost-then-cap conserves rows and keeps the cap's guarantee", () => {
  // The production pipeline: boost first, cap last.
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({ ...es(i), original_language: "es" })),
    ...Array.from({ length: 60 }, (_, i) => ({ ...other(100 + i), original_language: "en" })),
    ...Array.from({ length: 25 }, (_, i) => ({ id: 500 + i, origin_country: ["KR"], original_language: "ko" })),
  ];
  const out = capNonWestern(boostSpanish(rows));
  assertConserves(rows, out);
  for (let k = 1; k <= 72; k++) {
    const nonWestern = out.slice(0, k).filter((r) => r.original_language === "ko").length;
    assertEquals(nonWestern <= Math.ceil(k * 0.1), true, `prefix of ${k} holds ${nonWestern}`);
  }
});
