import { describe, it, expect } from "vitest";
import { computeAiredCount } from "@/domain/airedCount";

describe("computeAiredCount", () => {
  const seasons = [
    { season_number: 0, episode_count: 5 }, // specials — ignored
    { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 8 },
    { season_number: 3, episode_count: 6 },
  ];

  it("counts full prior seasons + partial current season", () => {
    // mid-way through season 3
    expect(computeAiredCount(seasons, { season_number: 3, episode_number: 4 })).toBe(22); // 10+8+4
  });

  it("equals the total for an ended show on its final episode", () => {
    expect(computeAiredCount(seasons, { season_number: 3, episode_number: 6 })).toBe(24); // 10+8+6
  });

  it("excludes specials from the running total", () => {
    expect(computeAiredCount(seasons, { season_number: 1, episode_number: 3 })).toBe(3);
  });

  it("returns null when nothing has aired (no last episode)", () => {
    expect(computeAiredCount(seasons, null)).toBeNull();
    expect(computeAiredCount(seasons, undefined)).toBeNull();
  });

  it("returns null when the last aired episode is a special", () => {
    expect(computeAiredCount(seasons, { season_number: 0, episode_number: 2 })).toBeNull();
  });

  it("treats a missing episode_count on a prior season as 0", () => {
    const gappy = [
      { season_number: 1, episode_count: null },
      { season_number: 2, episode_count: 8 },
    ];
    expect(computeAiredCount(gappy, { season_number: 2, episode_number: 2 })).toBe(2); // 0+2
  });
});
