import { describe, expect, it } from "vitest";
import { dayOffset, groupFeed, dayLabel, episodeBadge } from "@/domain/calendar";

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

describe("episodeBadge", () => {
  it("series premiere only for S1E1; season premiere otherwise; finale; else none", () => {
    expect(episodeBadge({ is_premiere: true, is_finale: false, season_number: 1 })).toBe("Series premiere");
    expect(episodeBadge({ is_premiere: true, is_finale: false, season_number: 3 })).toBe("Season premiere");
    expect(episodeBadge({ is_premiere: false, is_finale: true, season_number: 2 })).toBe("Season finale");
    expect(episodeBadge({ is_premiere: false, is_finale: false, season_number: 2 })).toBeNull();
  });
});
