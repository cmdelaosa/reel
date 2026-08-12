// Unit tests for the PostgREST paging helper. Run by CI's `edge` job (`deno test`).
//
// The case that matters is the first one: 1181 rows, One Piece's episode count,
// the number that broke the air-time enrichment by being over the 1000-row cap
// PostgREST applies silently. Everything after row 1000 was invisible, which on
// that show is every episode since 2021 — the ones the calendar actually shows.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { pageAll, PAGE_SIZE } from "./paging.ts";

/** A table of `total` rows behind a PostgREST-shaped windowed reader, which
 *  records the windows it was asked for. */
const table = (total: number) => {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const windows: [number, number][] = [];
  return {
    windows,
    page: (from: number, to: number) => {
      windows.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
};

Deno.test("reads past the 1000-row cap — all 1181 of One Piece's episodes", async () => {
  const t = table(1181);
  const got = await pageAll(t.page);
  assertEquals(got.length, 1181);
  assertEquals(got.at(-1), { n: 1180 });
  assertEquals(t.windows, [[0, 999], [1000, 1999]]);
});

Deno.test("a table that fits in one page costs one request", async () => {
  const t = table(42);
  assertEquals((await pageAll(t.page)).length, 42);
  assertEquals(t.windows.length, 1);
});

Deno.test("an exact multiple of the page size needs the empty page to know it ended", async () => {
  const t = table(PAGE_SIZE);
  assertEquals((await pageAll(t.page)).length, PAGE_SIZE);
  assertEquals(t.windows, [[0, 999], [1000, 1999]]);
});

Deno.test("an empty table reads as no rows, in one request", async () => {
  const t = table(0);
  assertEquals(await pageAll(t.page), []);
  assertEquals(t.windows.length, 1);
});

Deno.test("no row is lost or repeated across a boundary", async () => {
  const got = await pageAll(table(2500).page);
  assertEquals(got.map((r) => r.n), Array.from({ length: 2500 }, (_, i) => i));
});

Deno.test("an error is raised, never mistaken for an empty table", async () => {
  await assertRejects(
    () => pageAll(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    Error,
    "boom",
  );
});

Deno.test("an error on a later page does not silently return a partial read", async () => {
  const t = table(2500);
  await assertRejects(
    () => pageAll((from, to) => (from === 0 ? t.page(from, to) : Promise.resolve({ data: null, error: { message: "timeout" } }))),
    Error,
    "timeout",
  );
});
