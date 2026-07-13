import { describe, expect, it } from "vitest";
import { dayOffset, groupFeed, dayLabel, episodeBadge, clusterFeed } from "@/domain/calendar";

// Fixed local-time anchor (tests run in the machine's zone; offsets are local).
const now = new Date(2026, 6, 7, 20, 0); // Tue Jul 7 2026, 20:00 local

const at = (y: number, m: number, d: number, h = 21) => new Date(y, m, d, h).toISOString();

describe("dayOffset", () => {
  it("same local day → 0 even late at night", () => {
    expect(dayOffset(at(2026, 6, 7, 23), now)).toBe(0);
    expect(dayOffset(at(2026, 6, 7, 0), now)).toBe(0);
  });
  it("tomorrow → 1, yesterday → -1", () => {
    expect(dayOffset(at(2026, 6, 8), now)).toBe(1);
    expect(dayOffset(at(2026, 6, 6), now)).toBe(-1);
  });
  it("DST fall-back day still counts as one day (Europe: 2026-10-25)", () => {
    const dstNow = new Date(2026, 9, 24, 12, 0); // Oct 24 noon
    expect(dayOffset(at(2026, 9, 25, 12), dstNow)).toBe(1); // 25h wall day → still 1
  });
});

describe("groupFeed", () => {
  it("buckets 0..6 per day, ≥7 into later, past kept per-day", () => {
    const rows = [
      { air_datetime: at(2026, 6, 7) },   // today
      { air_datetime: at(2026, 6, 8) },   // tomorrow
      { air_datetime: at(2026, 6, 13) },  // +6 → its own day
      { air_datetime: at(2026, 6, 14) },  // +7 → later
      { air_datetime: at(2026, 6, 1) },   // -6 → past day
      { air_datetime: null },             // dropped
    ];
    const { days, later } = groupFeed(rows, now);
    expect(days.map(([o]) => o)).toEqual([-6, 0, 1, 6]);
    expect(later.length).toBe(1);
  });
});

describe("dayLabel", () => {
  it("Today / Tomorrow / weekday / past full date", () => {
    expect(dayLabel(0, at(2026, 6, 7))).toBe("Today");
    expect(dayLabel(1, at(2026, 6, 8))).toBe("Tomorrow");
    expect(dayLabel(3, at(2026, 6, 10))).toMatch(/day$/); // a weekday name
    expect(dayLabel(-2, at(2026, 6, 5))).toMatch(/JULY|JUL/);
  });
});

describe("clusterFeed", () => {
  const ep = (title: string, s: number, e: number, y: number, mo: number, d: number, h = 21) => ({
    title_id: title,
    season_number: s,
    episode_number: e,
    air_datetime: at(y, mo, d, h),
  });

  it("collapses a same-day same-show drop into one cluster, sorted E01→EN", () => {
    const rows = [
      ep("lupin", 3, 2, 2026, 9, 23),
      ep("lupin", 3, 1, 2026, 9, 23),
      ep("lupin", 3, 3, 2026, 9, 23),
    ];
    const out = clusterFeed(rows, now);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].lead.episode_number).toBe(1); // lowest leads
    expect(out[0].last.episode_number).toBe(3); // highest is the mark-up-to target
    expect(out[0].rest.map((r) => r.episode_number)).toEqual([2, 3]);
  });

  it("keeps a weekly show as separate single clusters (different days)", () => {
    const rows = [ep("slow", 6, 5, 2026, 9, 14), ep("slow", 6, 6, 2026, 9, 21)];
    const out = clusterFeed(rows, now);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.count === 1)).toBe(true);
  });

  it("does not merge two shows that drop on the same day", () => {
    const rows = [ep("a", 1, 1, 2026, 9, 23), ep("b", 1, 1, 2026, 9, 23)];
    const out = clusterFeed(rows, now);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.lead.title_id)).toEqual(["a", "b"]);
  });

  it("preserves chronological order of first-seen leads and drops null dates", () => {
    const rows = [
      ep("early", 1, 1, 2026, 6, 8),
      { title_id: "x", season_number: 1, episode_number: 1, air_datetime: null },
      ep("late", 1, 1, 2026, 6, 20),
    ];
    const out = clusterFeed(rows, now);
    expect(out.map((c) => c.lead.title_id)).toEqual(["early", "late"]);
  });
});

describe("episodeBadge", () => {
  it("series premiere only for S1E1; season premiere otherwise; finale; else none", () => {
    expect(episodeBadge({ is_premiere: true, is_finale: false, season_number: 1 })).toBe("Series premiere");
    expect(episodeBadge({ is_premiere: true, is_finale: false, season_number: 3 })).toBe("Season premiere");
    expect(episodeBadge({ is_premiere: false, is_finale: true, season_number: 2 })).toBe("Season finale");
    expect(episodeBadge({ is_premiere: false, is_finale: false, season_number: 2 })).toBeNull();
  });
});
