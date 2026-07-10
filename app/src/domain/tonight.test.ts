import { describe, expect, it } from "vitest";
import { orderByActivity, activityMs, premieresSoon, soonPremieres, recentlyAired } from "@/domain/tonight";

const item = (air: string | null, watched: string | null = null) => ({
  air_datetime: air,
  last_watched_at: watched,
});

describe("orderByActivity", () => {
  it("orders by the more recent of last-watch and next-episode air, newest first", () => {
    // caught up long ago, but a fresh episode just aired → resurfaces on top.
    const silo = item("2026-07-05T21:00:00Z", "2025-07-01T10:00:00Z"); // air 2d ago
    // behind for 2 months; oldest unwatched aired 2 months ago too.
    const strangerThings = item("2026-05-07T21:00:00Z", "2026-05-07T22:00:00Z");
    // watched yesterday, mid-season; next episode aired a week ago.
    const active = item("2026-06-30T21:00:00Z", "2026-07-06T10:00:00Z"); // watched 1d ago
    expect(orderByActivity([strangerThings, silo, active])).toEqual([active, silo, strangerThings]);
  });

  it("last-watch wins when it is more recent than the next-episode air", () => {
    const it = item("2026-01-01T21:00:00Z", "2026-07-06T10:00:00Z");
    expect(activityMs(it)).toBe(new Date("2026-07-06T10:00:00Z").getTime());
  });

  it("next-episode air wins when the show was caught up before it aired", () => {
    const it = item("2026-07-05T21:00:00Z", "2025-07-01T10:00:00Z");
    expect(activityMs(it)).toBe(new Date("2026-07-05T21:00:00Z").getTime());
  });

  it("does not mutate the input array", () => {
    const input = [item("2026-01-01T21:00:00Z"), item("2026-07-01T21:00:00Z")];
    const snapshot = [...input];
    orderByActivity(input);
    expect(input).toEqual(snapshot);
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

describe("recentlyAired", () => {
  const now = new Date("2026-07-07T20:00:00Z");
  const ep = (id: string, air: string) => ({ episode_id: id, air_datetime: air });

  it("keeps episodes aired in the last 5 days, newest first", () => {
    const a = ep("a", "2026-07-06T21:00:00Z"); // ~1d ago
    const b = ep("b", "2026-07-03T21:00:00Z"); // ~4d ago
    const old = ep("old", "2026-07-01T21:00:00Z"); // ~6d ago
    const future = ep("f", "2026-07-09T21:00:00Z");
    expect(recentlyAired([old, b, future, a], now).map((e) => e.episode_id)).toEqual(["a", "b"]);
  });

  it("keeps every recent episode (several per show is fine)", () => {
    const rows = [ep("e1", "2026-07-05T21:00:00Z"), ep("e2", "2026-07-06T21:00:00Z"), ep("e3", "2026-07-07T10:00:00Z")];
    expect(recentlyAired(rows, now)).toHaveLength(3);
  });
});

describe("soonPremieres", () => {
  const now = new Date("2026-07-07T20:00:00Z");
  const ep = (over: Partial<Parameters<typeof soonPremieres>[0][number]>) => ({
    title_id: "t", air_datetime: "2026-07-20T21:00:00Z", is_premiere: true,
    ...over,
  });

  it("keeps future premieres within 60 days, soonest first", () => {
    const a = ep({ title_id: "a", air_datetime: "2026-07-25T21:00:00Z" });
    const b = ep({ title_id: "b", air_datetime: "2026-07-12T21:00:00Z" });
    expect(soonPremieres([a, b], now).map((e) => e.title_id)).toEqual(["b", "a"]);
  });

  it("drops non-premiere episodes, past dates, and premieres beyond 60 days", () => {
    const notPremiere = ep({ title_id: "x", is_premiere: false });
    const past = ep({ title_id: "y", air_datetime: "2026-07-01T21:00:00Z" });
    const farOff = ep({ title_id: "z", air_datetime: "2026-12-01T21:00:00Z" });
    expect(soonPremieres([notPremiere, past, farOff], now)).toEqual([]);
  });

  it("dedupes to one (soonest) row per show", () => {
    const first = ep({ title_id: "dup", air_datetime: "2026-07-12T21:00:00Z" });
    const later = ep({ title_id: "dup", air_datetime: "2026-07-30T21:00:00Z" });
    const out = soonPremieres([later, first], now);
    expect(out).toHaveLength(1);
    expect(out[0].air_datetime).toBe("2026-07-12T21:00:00Z");
  });
});
