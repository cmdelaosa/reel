/* Pure helpers behind the per-season episode-rating graph and the season
   aggregate shown on the detail sheet. No React and no data fetching, so the
   geometry and the averaging are unit-tested in isolation (episodeRatings.test.ts).

   The graph plots IMDb ratings only (a decision: one clean line people
   recognise); TMDB's per-episode score lives on the episode sub-sheet beside it.
   IMDb scores run 0–10. */

export interface RatedEpisode {
  episode_number: number;
  imdb_rating?: number | null;
  tmdb_vote_average?: number | null;
}

/** Mean of the present (finite) values, to one decimal. null when there are none
 *  — the caller then hides the figure rather than printing a hollow 0.0. */
export function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10;
}

/** A season's IMDb aggregate — the mean of its episodes' IMDb ratings. */
export const seasonImdbAverage = (eps: RatedEpisode[]): number | null =>
  average(eps.map((e) => e.imdb_rating));

export interface ChartPoint {
  x: number;
  y: number;
  rating: number;
  index: number; // 0-based slot within the season (drives the x position)
  episode_number: number;
}
/** A y-axis gridline: its rating `value` and the pixel `y` it sits at. */
export interface ChartTick {
  value: number;
  y: number;
}
export interface ChartGeometry {
  points: ChartPoint[];
  path: string; // polyline "M x y L x y …" through the rated points, in order
  domain: [number, number]; // [lo, hi] rating bounds the y-axis spans
  ticks: ChartTick[]; // gridlines to draw, low→high, with pixel y precomputed
  xs: number[]; // x pixel of every episode slot, index-aligned to the input eps
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const RATING_MAX = 10;
const MIN_SPAN = 1; // never squash a near-flat season into visual noise
const half = (v: number) => Math.round(v * 2) / 2; // snap to a clean 0.5 step

/** Lay out a season's IMDb ratings for an SVG line chart inside a w×h box with
 *  `padding` inset on each side. Unrated episodes are skipped (no point) but keep
 *  their x-slot, so the line reads against episode position — a trailing gap for
 *  a season still airing, say. Returns null when nothing in the season is rated
 *  yet (the caller hides the chart). */
export function chartGeometry(
  eps: RatedEpisode[],
  w: number,
  h: number,
  padding: ChartPadding,
): ChartGeometry | null {
  const rated = eps
    .map((e, i) => ({ e, i }))
    .filter((x) => typeof x.e.imdb_rating === "number" && Number.isFinite(x.e.imdb_rating as number));
  if (!rated.length) return null;

  const values = rated.map((x) => x.e.imdb_rating as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad the domain so points don't kiss the frame and a flat season keeps a
  // readable band; snap the bounds to 0.5 for clean labels; clamp to 0–10.
  const pad = Math.max((max - min) * 0.15, (MIN_SPAN - (max - min)) / 2, 0.25);
  const lo = Math.max(0, half(min - pad));
  const hi = Math.min(RATING_MAX, half(max + pad));
  const domain: [number, number] = hi - lo < 0.5 ? [Math.max(0, hi - MIN_SPAN), hi] : [lo, hi];

  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;
  const n = eps.length;
  const xFor = (i: number) => padding.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (r: number) => padding.top + (1 - (r - domain[0]) / (domain[1] - domain[0])) * innerH;

  const points: ChartPoint[] = rated.map((x) => ({
    x: xFor(x.i),
    y: yFor(x.e.imdb_rating as number),
    rating: x.e.imdb_rating as number,
    index: x.i,
    episode_number: x.e.episode_number,
  }));
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  // Three gridlines: the two bounds and a midpoint snapped to 0.5 (deduped for a
  // narrow domain where the midpoint collides with a bound). Pixel y is computed
  // here — the single owner of the domain→y scale — so the chart never restates
  // it. Likewise the per-episode x positions.
  const mid = half((domain[0] + domain[1]) / 2);
  const ticks: ChartTick[] = [...new Set([domain[0], mid, domain[1]])]
    .sort((a, b) => a - b)
    .map((value) => ({ value, y: yFor(value) }));
  const xs = eps.map((_, i) => xFor(i));
  return { points, path, domain, ticks, xs };
}
