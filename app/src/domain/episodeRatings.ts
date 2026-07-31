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

const isRated = (e: RatedEpisode): boolean =>
  typeof e.imdb_rating === "number" && Number.isFinite(e.imdb_rating);

/* A line needs somewhere to go before it means anything. One or two rated
   episodes don't describe a season's shape — and worse, a single dot on an axis
   reads as "this season has one episode", which is how a currently-airing season
   (IMDb rates episodes as they air) looked before this floor existed. Below it we
   render nothing at all, including the average: the mean of one episode is not a
   season rating. */
export const MIN_CHART_POINTS = 3;

/** Whether a season has enough rated episodes to be worth charting. */
export const hasChartableRatings = (eps: RatedEpisode[]): boolean =>
  eps.filter(isRated).length >= MIN_CHART_POINTS;

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

/* The y-axis is ALWAYS the full 0–10 rating scale, never fitted to the season on
   screen. A fitted axis makes every season look equally dramatic — a run from 7.8
   to 8.2 and one from 4 to 10 both fill the box — so switching seasons compared
   nothing and a flat season read as a rollercoaster. Fixed bounds cost some
   vertical detail (most TV sits between 7 and 9.5, so the line rides high) and buy
   the thing a season picker is for: seasons you can hold against each other. */
const RATING_MIN = 0;
const RATING_MAX = 10;
const DOMAIN: [number, number] = [RATING_MIN, RATING_MAX];
// Gridlines at the bounds and the midpoint, i.e. 0 / 5 / 10.
const TICK_VALUES = [RATING_MIN, (RATING_MIN + RATING_MAX) / 2, RATING_MAX];

/** Lay out a season's IMDb ratings for an SVG line chart inside a w×h box with
 *  `padding` inset on each side. The y-axis is always 0–10 (see DOMAIN), so two
 *  seasons of the same show are directly comparable. Unrated episodes are skipped
 *  (no point) but keep their x-slot, so the line reads against episode position —
 *  a trailing gap for a season still airing, say. Returns null when the season
 *  can't clear MIN_CHART_POINTS (the caller hides the chart). */
export function chartGeometry(
  eps: RatedEpisode[],
  w: number,
  h: number,
  padding: ChartPadding,
): ChartGeometry | null {
  const rated = eps.map((e, i) => ({ e, i })).filter((x) => isRated(x.e));
  // Below the floor there is no chart to draw — see MIN_CHART_POINTS.
  if (rated.length < MIN_CHART_POINTS) return null;

  const domain = DOMAIN;

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

  // Pixel y is computed here — the single owner of the domain→y scale — so the
  // chart never restates it. Likewise the per-episode x positions.
  const ticks: ChartTick[] = TICK_VALUES.map((value) => ({ value, y: yFor(value) }));
  const xs = eps.map((_, i) => xFor(i));
  return { points, path, domain, ticks, xs };
}
