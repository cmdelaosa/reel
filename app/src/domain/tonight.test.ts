import { describe, expect, it } from "vitest";
import { splitTonight, premieresSoon } from "@/domain/tonight";

const item = (air: string | null, watched: string | null = null) => ({
  air_datetime: air,
  last_watched_at: watched,
});

describe("splitTonight", () => {
  const now = new Date("2026-07-07T20:00:00Z");

  it("fresh = aired within 7 days, newest first", () => {
    const a = item("2026-07-06T21:00:00Z"); // 1d ago
    const b = item("2026-07-01T21:00:00Z"); // 6d ago
    const c = item("2026-06-20T21:00:00Z"); // 17d ago → continue
    const { fresh, cont } = splitTonight([b, c, a], now);
    expect(fresh).toEqual([a, b]);
    expect(cont).toEqual([c]);
  });

  it("continue sorts by last watch activity desc, nulls last", () => {
    const a = item("2026-01-01T21:00:00Z", "2026-07-01T10:00:00Z");
    const b = item("2026-01-01T21:00:00Z", "2026-07-05T10:00:00Z");
    const c = item("2026-01-01T21:00:00Z", null);
    const { cont } = splitTonight([a, c, b], now);
    expect(cont).toEqual([b, a, c]);
  });

  it("exact 7-day boundary is still fresh; a millisecond past is not", () => {
    const edge = item("2026-06-30T20:00:00Z"); // exactly 7*24h before now
    const past = item("2026-06-30T19:59:59.999Z");
    const { fresh, cont } = splitTonight([edge, past], now);
    expect(fresh).toEqual([edge]);
    expect(cont).toEqual([past]);
  });

  it("DST spring-forward (Europe: 2026-03-29) does not skew the window", () => {
    // now: 5 wall-clock days after the CET→CEST jump; the episode aired
    // 6d23h of absolute time before now → still fresh even though local
    // wall-clock arithmetic would say "7 days and 1 hour".
    const dstNow = new Date("2026-04-02T20:00:00+02:00");
    const aired = new Date(dstNow.getTime() - (7 * 24 - 1) * 3600_000).toISOString();
    const over = new Date(dstNow.getTime() - (7 * 24 + 1) * 3600_000).toISOString();
    const { fresh, cont } = splitTonight([item(aired), item(over)], dstNow);
    expect(fresh.length).toBe(1);
    expect(cont.length).toBe(1);
  });

  it("future-dated up-next rows are never fresh", () => {
    const future = item("2026-07-08T21:00:00Z");
    const { fresh, cont } = splitTonight([future], now);
    expect(fresh).toEqual([]);
    expect(cont).toEqual([future]);
  });
});

describe("premieresSoon", () => {
  const now = new Date("2026-07-07T20:00:00Z");
  const show = (status: string, next: string | null, first: string | null) => ({
    status,
    next_air_datetime: next,
    first_air_date: first,
  });

  it("keeps upcoming shows premiering within 60 days, soonest first", () => {
    const a = show("upcoming", "2026-07-20T21:00:00Z", null);
    const b = show("upcoming", null, "2026-08-15"); // via first_air_date fallback
    const far = show("upcoming", null, "2026-12-01"); // > 60d
    const watching = show("watching", "2026-07-10T21:00:00Z", null);
    expect(premieresSoon([b, far, a, watching], now)).toEqual([a, b]);
  });

  it("drops TBA (no date at all) and already-premiered", () => {
    const tba = show("upcoming", null, null);
    const past = show("upcoming", null, "2026-07-01");
    expect(premieresSoon([tba, past], now)).toEqual([]);
  });
});
