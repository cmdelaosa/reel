import { describe, it, expect } from "vitest";
import { computeAiredCount, computeUpcomingSeason } from "@/domain/airedCount";

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

describe("computeUpcomingSeason", () => {
  const seasons = [
    { season_number: 0, air_date: "2019-12-01" }, // specials — ignored
    { season_number: 1, air_date: "2020-01-01" },
    { season_number: 2, air_date: "2021-01-01" },
    { season_number: 3, air_date: null }, // announced, not yet dated
  ];

  it("returns the next announced season beyond the last aired, with its air_date", () => {
    // caught up on the S2 finale; S3 is announced but undated
    expect(computeUpcomingSeason(seasons, { season_number: 2, episode_number: 8 })).toEqual({
      number: 3,
      air_date: null,
    });
  });

  it("returns a dated upcoming season when TMDB has dated it", () => {
    const dated = [
      { season_number: 1, air_date: "2020-01-01" },
      { season_number: 2, air_date: "2026-09-01" },
    ];
    expect(computeUpcomingSeason(dated, { season_number: 1, episode_number: 10 })).toEqual({
      number: 2,
      air_date: "2026-09-01",
    });
  });

  it("returns null mid-season (no season exists past the airing one)", () => {
    // airing S3 weekly — the next episode is dated, not a whole new season
    expect(computeUpcomingSeason(seasons, { season_number: 3, episode_number: 2 })).toBeNull();
  });

  it("returns null when nothing has aired yet (a new show, not returning)", () => {
    expect(computeUpcomingSeason(seasons, null)).toBeNull();
    expect(computeUpcomingSeason(seasons, undefined)).toBeNull();
  });

  it("returns null when the last aired episode is a special", () => {
    expect(computeUpcomingSeason(seasons, { season_number: 0, episode_number: 2 })).toBeNull();
  });

  it("picks the lowest-numbered season when several are announced", () => {
    const many = [
      { season_number: 1, air_date: "2020-01-01" },
      { season_number: 3, air_date: null },
      { season_number: 2, air_date: "2026-09-01" },
    ];
    expect(computeUpcomingSeason(many, { season_number: 1, episode_number: 10 })).toEqual({
      number: 2,
      air_date: "2026-09-01",
    });
  });
});
