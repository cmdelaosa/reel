import { describe, expect, it } from "vitest";
import {
  average,
  chartGeometry,
  seasonImdbAverage,
  seasonTmdbAverage,
  type ChartPadding,
  type RatedEpisode,
} from "./episodeRatings";

const ep = (episode_number: number, imdb?: number | null, tmdb?: number | null): RatedEpisode => ({
  episode_number,
  imdb_rating: imdb,
  tmdb_vote_average: tmdb,
});

const PAD: ChartPadding = { top: 10, right: 10, bottom: 10, left: 10 };

describe("average", () => {
  it("means the finite values to one decimal", () => {
    expect(average([8, 9, 10])).toBe(9);
    expect(average([8, 9])).toBe(8.5);
    expect(average([9, 8, 8])).toBe(8.3); // 25/3 = 8.33… → 8.3
  });

  it("ignores null/undefined/NaN and returns null when empty", () => {
    expect(average([null, undefined, 7])).toBe(7);
    expect(average([NaN, 9])).toBe(9);
    expect(average([])).toBeNull();
    expect(average([null, undefined])).toBeNull();
  });
});

describe("season aggregates", () => {
  it("averages each source independently, skipping gaps", () => {
    const eps = [ep(1, 9.1, 8.4), ep(2, 8.7, null), ep(3, null, 8.0)];
    expect(seasonImdbAverage(eps)).toBe(8.9); // (9.1 + 8.7) / 2
    expect(seasonTmdbAverage(eps)).toBe(8.2); // (8.4 + 8.0) / 2
  });

  it("is null when a source has no ratings at all", () => {
    expect(seasonImdbAverage([ep(1, null), ep(2, null)])).toBeNull();
  });
});

describe("chartGeometry", () => {
  it("returns null when no episode is rated", () => {
    expect(chartGeometry([ep(1, null), ep(2, null)], 300, 120, PAD)).toBeNull();
  });

  it("plots only rated episodes but keeps their x-slot", () => {
    const eps = [ep(1, 8), ep(2, null), ep(3, 9)];
    const g = chartGeometry(eps, 210, 120, PAD)!;
    expect(g.points).toHaveLength(2);
    expect(g.points.map((p) => p.episode_number)).toEqual([1, 3]);
    // Slot 0 sits at the left inset, slot 2 (last of three) at the right inset.
    expect(g.points[0].x).toBeCloseTo(10);
    expect(g.points[1].x).toBeCloseTo(200);
    expect(g.points[0].index).toBe(0);
    expect(g.points[1].index).toBe(2);
  });

  it("orders the path low→high by episode and maps the top rating higher on screen", () => {
    const g = chartGeometry([ep(1, 7), ep(2, 9)], 210, 120, PAD)!;
    expect(g.path.startsWith("M")).toBe(true);
    // Higher rating → smaller y (SVG origin is top-left).
    expect(g.points[1].y).toBeLessThan(g.points[0].y);
  });

  it("clamps the domain to 0–10 and never squashes a flat season below MIN_SPAN", () => {
    const flat = chartGeometry([ep(1, 8), ep(2, 8), ep(3, 8)], 300, 120, PAD)!;
    expect(flat.domain[0]).toBeGreaterThanOrEqual(0);
    expect(flat.domain[1]).toBeLessThanOrEqual(10);
    expect(flat.domain[1] - flat.domain[0]).toBeGreaterThanOrEqual(1);
  });

  it("centers a lone rated episode", () => {
    const g = chartGeometry([ep(1, 8.5)], 210, 120, PAD)!;
    expect(g.points).toHaveLength(1);
    expect(g.points[0].x).toBeCloseTo(105); // padding.left + innerW/2 = 10 + 190/2
  });

  it("keeps y ticks within the domain, low→high", () => {
    const g = chartGeometry([ep(1, 6.2), ep(2, 9.4)], 300, 120, PAD)!;
    expect(g.ticks[0]).toBe(g.domain[0]);
    expect(g.ticks[g.ticks.length - 1]).toBe(g.domain[1]);
    for (let i = 1; i < g.ticks.length; i++) expect(g.ticks[i]).toBeGreaterThan(g.ticks[i - 1]);
  });
});
