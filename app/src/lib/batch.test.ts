import { describe, expect, it, vi } from "vitest";
import { createBatcher } from "@/lib/batch";

/* The batching loader's contract, driven with a fake fetchMany — which is why
   that parameter exists. lib/providers can't host this: it imports the
   Supabase client, which throws at import time without credentials, so a test
   reaching through it dies in CI (as this one did). */

const mapOf = (entries: Record<number, string[]>) =>
  new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));

describe("createBatcher", () => {
  it("collapses the ids asked for in one tick into a single call", async () => {
    const fetchMany = vi.fn(async (ids: number[]) =>
      mapOf(Object.fromEntries(ids.map((i) => [i, [`p${i}`]]))));
    const load = createBatcher(fetchMany);

    const [a, b, c] = await Promise.all([load(1), load(2), load(3)]);

    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany.mock.calls[0][0]).toEqual([1, 2, 3]);
    expect([a, b, c]).toEqual([["p1"], ["p2"], ["p3"]]);
  });

  it("asks for a repeated id once but answers every caller", async () => {
    const fetchMany = vi.fn(async (ids: number[]) =>
      mapOf(Object.fromEntries(ids.map((i) => [i, ["Netflix"]]))));
    const load = createBatcher(fetchMany);

    const [first, second] = await Promise.all([load(7), load(7)]);

    expect(fetchMany.mock.calls[0][0]).toEqual([7]);
    expect(first).toEqual(["Netflix"]);
    expect(second).toEqual(["Netflix"]);
  });

  it("answers an id the fetch returned no row for with nothing, not undefined", async () => {
    const load = createBatcher(async () => mapOf({}));
    // A title we hold no row for and one with no provider here are the same
    // answer to the only question the caller asks: which logos do I draw?
    expect(await load(42)).toEqual([]);
  });

  it("opens a fresh batch once the previous one has flushed", async () => {
    const fetchMany = vi.fn(async (ids: number[]) =>
      mapOf(Object.fromEntries(ids.map((i) => [i, [`p${i}`]]))));
    const load = createBatcher(fetchMany);

    await load(1);
    await load(2);

    expect(fetchMany).toHaveBeenCalledTimes(2);
    expect(fetchMany.mock.calls[1][0]).toEqual([2]);
  });

  it("starts a new batch for ids arriving while the previous fetch is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMany = vi.fn(async (ids: number[]) => {
      if (ids.includes(1)) await gate;
      return mapOf(Object.fromEntries(ids.map((i) => [i, [`p${i}`]])));
    });
    const load = createBatcher(fetchMany);

    const slow = load(1);
    // Let the first flush run, so the queue is drained but its fetch pending.
    await new Promise((r) => setTimeout(r, 0));
    const fast = load(2);

    expect(await fast).toEqual(["p2"]);
    release();
    expect(await slow).toEqual(["p1"]);
    expect(fetchMany).toHaveBeenCalledTimes(2);
  });

  it("rejects every caller in the batch when the fetch fails", async () => {
    // Propagating matters: React Query has to see a failure to retry it and to
    // fire the global error toast, instead of caching an empty answer.
    const load = createBatcher(async () => { throw new Error("network down"); });

    await expect(Promise.all([load(1), load(2)])).rejects.toThrow("network down");
  });

  it("recovers on the next call after a failed batch", async () => {
    let fail = true;
    const load = createBatcher(async (ids: number[]) => {
      if (fail) { fail = false; throw new Error("transient"); }
      return mapOf(Object.fromEntries(ids.map((i) => [i, [`p${i}`]])));
    });

    await expect(load(1)).rejects.toThrow("transient");
    expect(await load(1)).toEqual(["p1"]);
  });

  it("keeps separate batchers independent", async () => {
    const a = vi.fn(async () => mapOf({ 1: ["A"] }));
    const b = vi.fn(async () => mapOf({ 1: ["B"] }));

    expect(await Promise.all([createBatcher(a)(1), createBatcher(b)(1)]))
      .toEqual([["A"], ["B"]]);
  });
});
