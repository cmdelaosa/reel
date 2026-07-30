import { describe, expect, it } from "vitest";
import {
  average,
  chartGeometry,
  hasChartableRatings,
  MIN_CHART_POINTS,
  MIN_VOTES,
  ratingOf,
  seasonAverage,
  type ChartPadding,
  type RatedEpisode,
} from "./episodeRatings";

/** An episode with a TMDB score; votes default to comfortably above MIN_VOTES so
 *  the geometry tests aren't silently filtered by the vote floor. */
const ep = (episode_number: number, tmdb?: number | null, votes = 50): RatedEpisode => ({
  episode_number,
  tmdb_vote_average: tmdb,
  tmdb_vote_count: votes,
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

describe("ratingOf", () => {
  it("requires MIN_VOTES before trusting a score", () => {
    expect(MIN_VOTES).toBe(5);
    expect(ratingOf(ep(1, 8.4, MIN_VOTES))).toBe(8.4);
    // Thin-voted scores correlate with IMDb at 0.04 — noise, not a rating.
    expect(ratingOf(ep(1, 8.4, MIN_VOTES - 1))).toBeNull();
    expect(ratingOf(ep(1, 9.9, 0))).toBeNull();
  });

  it("treats a missing or zero score as absent", () => {
    expect(ratingOf(ep(1, null))).toBeNull();
    expect(ratingOf(ep(1, undefined))).toBeNull();
    // TMDB reports 0 for an unrated episode; that's absence, not a bottom score.
    expect(ratingOf(ep(1, 0))).toBeNull();
  });

  it("defaults a missing vote count to untrusted", () => {
    expect(ratingOf({ episode_number: 1, tmdb_vote_average: 8 })).toBeNull();
  });
});

describe("seasonAverage", () => {
  it("averages the trustworthy scores, skipping gaps", () => {
    const eps = [ep(1, 9.1), ep(2, 8.7), ep(3, null)];
    expect(seasonAverage(eps)).toBe(8.9); // (9.1 + 8.7) / 2
  });

  it("excludes thin-voted episodes from the aggregate", () => {
    // The 2.0 would drag the mean down if its 1 vote counted.
    expect(seasonAverage([ep(1, 9), ep(2, 9), ep(3, 2, 1)])).toBe(9);
  });

  it("is null when nothing is rated", () => {
    expect(seasonAverage([ep(1, null), ep(2, null)])).toBeNull();
  });
});

describe("hasChartableRatings", () => {
  it("needs MIN_CHART_POINTS trustworthy scores", () => {
    expect(MIN_CHART_POINTS).toBe(3);
    expect(hasChartableRatings([ep(1, null), ep(2, null)])).toBe(false);
    // A season that just started airing: only episode 1 scored.
    expect(hasChartableRatings([ep(1, 7.3), ep(2, null), ep(3, null)])).toBe(false);
    expect(hasChartableRatings([ep(1, 7.3), ep(2, 8), ep(3, null)])).toBe(false);
    expect(hasChartableRatings([ep(1, 7.3), ep(2, 8), ep(3, 8.4)])).toBe(true);
    // Thin votes don't count toward the floor.
    expect(hasChartableRatings([ep(1, 7.3), ep(2, 8), ep(3, 8.4, 1)])).toBe(false);
  });
});

describe("chartGeometry", () => {
  it("returns null when no episode is rated", () => {
    expect(chartGeometry([ep(1, null), ep(2, null)], 300, 120, PAD)).toBeNull();
  });

  it("returns null below the point floor — a lone dot is not a chart", () => {
    expect(chartGeometry([ep(1, 7.3), ep(2, null), ep(3, null)], 300, 120, PAD)).toBeNull();
    expect(chartGeometry([ep(1, 8.5)], 210, 120, PAD)).toBeNull();
    expect(chartGeometry([ep(1, 7), ep(2, 9)], 210, 120, PAD)).toBeNull();
  });

  it("plots only trustworthy scores but keeps their x-slot", () => {
    const eps = [ep(1, 8), ep(2, null), ep(3, 9), ep(4, 8.5)];
    const g = chartGeometry(eps, 310, 120, PAD)!;
    expect(g.points).toHaveLength(3);
    expect(g.points.map((p) => p.episode_number)).toEqual([1, 3, 4]);
    // Slot 0 sits at the left inset, slot 3 (last of four) at the right inset.
    expect(g.points[0].x).toBeCloseTo(10);
    expect(g.points[2].x).toBeCloseTo(300);
    expect(g.points[0].index).toBe(0);
    expect(g.points[2].index).toBe(3);
    // xs carries every slot (incl. the unrated one) and agrees with the points.
    expect(g.xs).toHaveLength(4);
    expect(g.xs[0]).toBeCloseTo(g.points[0].x);
    expect(g.xs[3]).toBeCloseTo(g.points[2].x);
  });

  it("skips a thin-voted episode the same way it skips a missing one", () => {
    const g = chartGeometry([ep(1, 8), ep(2, 2, 1), ep(3, 9), ep(4, 8.5)], 310, 120, PAD)!;
    expect(g.points.map((p) => p.episode_number)).toEqual([1, 3, 4]);
  });

  it("orders the path low→high by episode and maps the top rating higher on screen", () => {
    const g = chartGeometry([ep(1, 7), ep(2, 8), ep(3, 9)], 210, 120, PAD)!;
    expect(g.path.startsWith("M")).toBe(true);
    // Higher rating → smaller y (SVG origin is top-left).
    expect(g.points[2].y).toBeLessThan(g.points[0].y);
  });

  it("clamps the domain to 0–10 and never squashes a flat season below MIN_SPAN", () => {
    const flat = chartGeometry([ep(1, 8), ep(2, 8), ep(3, 8)], 300, 120, PAD)!;
    expect(flat.domain[0]).toBeGreaterThanOrEqual(0);
    expect(flat.domain[1]).toBeLessThanOrEqual(10);
    expect(flat.domain[1] - flat.domain[0]).toBeGreaterThanOrEqual(1);
  });

  it("keeps y ticks within the domain, low→high, with pixel y precomputed", () => {
    const g = chartGeometry([ep(1, 6.2), ep(2, 8), ep(3, 9.4)], 300, 120, PAD)!;
    const last = g.ticks[g.ticks.length - 1];
    expect(g.ticks[0].value).toBe(g.domain[0]);
    expect(last.value).toBe(g.domain[1]);
    for (let i = 1; i < g.ticks.length; i++) expect(g.ticks[i].value).toBeGreaterThan(g.ticks[i - 1].value);
    // y grows downward, so the lowest rating sits below the highest.
    expect(g.ticks[0].y).toBeGreaterThan(last.y);
  });
});
