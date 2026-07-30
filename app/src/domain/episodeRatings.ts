/* Pure helpers behind the per-season episode-rating graph and the season
   aggregate shown on the detail sheet. No React and no data fetching, so the
   geometry and the averaging are unit-tested in isolation (episodeRatings.test.ts).

   SOURCE: TMDB, not IMDb — a reversal of the original choice, made once the two
   could be compared on real data (2026-07-30, ~5.9k episodes carrying both):

     • IMDb, via OMDb, has holes we cannot close: 6957 episodes sit inside
       otherwise-rated seasons with no score at all. Asked for those episodes
       directly OMDb still answers "N/A" while reporting their vote count
       (Breaking Bad's "Crawl Space": 54650 votes, no rating) — its data is
       simply missing the field. Four of Breaking Bad season 4's thirteen
       episodes were unplottable.
     • TMDB, where it has data, is complete: 3 holes in the entire library.

   The catch is vote depth. Correlation with IMDb climbs with TMDB's vote count
   — 0.04 under 5 votes, 0.41 at 5-19, 0.66 at 20-49, 0.84 past 200 — and the
   mean gap shrinks from 2.53 points to ~0.6. Under 5 votes a TMDB score is not a
   quality signal at all, so plotting it would trade honest gaps for invented
   peaks. MIN_VOTES is what keeps the switch honest.

   (IMDb keeps the headline slot: the show's score on the detail sheet, and the
   per-episode figure beside TMDB's on the episode sub-sheet. This module governs
   the graph only.) */

export interface RatedEpisode {
  episode_number: number;
  tmdb_vote_average?: number | null;
  tmdb_vote_count?: number | null;
}

/** Votes a TMDB episode score needs before it means anything. Below this the
 *  number is noise (correlation with IMDb: 0.04) and is treated as absent. */
export const MIN_VOTES = 5;

/** The score to plot for an episode, or null when it has none worth trusting. */
export const ratingOf = (e: RatedEpisode): number | null => {
  const v = e.tmdb_vote_average;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return (e.tmdb_vote_count ?? 0) >= MIN_VOTES ? v : null;
};

/** Mean of the present (finite) values, to one decimal. null when there are none
 *  — the caller then hides the figure rather than printing a hollow 0.0. */
export function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10;
}

/** A season's aggregate — the mean of its episodes' plottable scores. */
export const seasonAverage = (eps: RatedEpisode[]): number | null =>
  average(eps.map(ratingOf));

/* A line needs somewhere to go before it means anything. One or two rated
   episodes don't describe a season's shape — and worse, a single dot on an axis
   reads as "this season has one episode", which is how a season that had only
   just started airing looked before this floor existed. Below it we render
   nothing at all, including the average: the mean of one episode is not a season
   rating. */
export const MIN_CHART_POINTS = 3;

/** Whether a season has enough trustworthy scores to be worth charting. */
export const hasChartableRatings = (eps: RatedEpisode[]): boolean =>
  eps.filter((e) => ratingOf(e) != null).length >= MIN_CHART_POINTS;

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

/** Lay out a season's episode scores for an SVG line chart inside a w×h box with
 *  `padding` inset on each side. Episodes without a trustworthy score are skipped
 *  (no point) but keep their x-slot, so the line reads against episode position —
 *  a trailing gap for a season still airing, say. Returns null when the season
 *  can't clear MIN_CHART_POINTS (the caller hides the chart). */
export function chartGeometry(
  eps: RatedEpisode[],
  w: number,
  h: number,
  padding: ChartPadding,
): ChartGeometry | null {
  const rated = eps
    .map((e, i) => ({ v: ratingOf(e), e, i }))
    .filter((x): x is { v: number; e: RatedEpisode; i: number } => x.v != null);
  // Below the floor there is no chart to draw — see MIN_CHART_POINTS.
  if (rated.length < MIN_CHART_POINTS) return null;

  const values = rated.map((x) => x.v);
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
    y: yFor(x.v),
    rating: x.v,
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
