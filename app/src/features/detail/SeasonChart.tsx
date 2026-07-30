import { Star } from "lucide-react";
import type { EpisodeRow } from "@/lib/schemas";
import { t as tr, tv } from "@/lib/i18n";
import { chartGeometry, seasonAverage } from "@/domain/episodeRatings";

/* Per-season episode-rating graph — a single hand-rolled SVG line (no chart
   dependency), theme-aware through the tokens. Plots TMDB scores: they're the
   only source complete enough to draw a line through (see episodeRatings.ts for
   the comparison that settled it), and thin-voted episodes are filtered out
   there rather than plotted as noise. IMDb's per-episode figure is still shown,
   beside TMDB's, on the episode sub-sheet. The season picker above the episode
   list drives which season is shown, so this component just renders whatever
   season it's handed. Tapping a point opens that episode's sub-sheet — the same
   action as its row below. */

// viewBox units; the SVG scales to its container width (width:100%, height:auto).
const W = 680;
const H = 150;
const PAD = { top: 14, right: 14, bottom: 26, left: 34 };

export function SeasonChart({ episodes, onPick }: { episodes: EpisodeRow[]; onPick: (e: EpisodeRow) => void }) {
  const geo = chartGeometry(episodes, W, H, PAD);
  if (!geo) return null;
  const avg = seasonAverage(episodes);

  // Label a handful of x positions (first, last, and a few between) so a long
  // season doesn't smear its episode numbers into an unreadable band. Pixel
  // positions come from geo.xs — chartGeometry owns the x scale.
  const step = Math.max(1, Math.ceil(episodes.length / 8));

  return (
    <div className="season-chart">
      <div className="season-chart-head">
        <div className="eyebrow">{tr("Episode ratings")}</div>
        {avg != null && (
          <div className="season-chart-agg" title={tr("Season average (TMDB)")}>
            <Star size={14} fill="currentColor" strokeWidth={0} />
            {avg.toFixed(1)}
            <span className="mute" style={{ fontWeight: 600, fontSize: 12 }}>TMDB</span>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          avg != null
            ? tv("TMDB episode ratings for this season, averaging {avg}", { avg: avg.toFixed(1) })
            : tr("TMDB episode ratings for this season")
        }
      >
        {/* Horizontal gridlines + their rating labels */}
        {geo.ticks.map((tick) => (
          <g key={tick.value}>
            <line className="grid-line" x1={PAD.left} y1={tick.y} x2={W - PAD.right} y2={tick.y} />
            <text className="grid-label" x={PAD.left - 6} y={tick.y} dominantBaseline="middle" textAnchor="end">
              {tick.value.toFixed(1)}
            </text>
          </g>
        ))}

        {/* The rating line, then the dots on top */}
        <path className="rating-line" d={geo.path} />
        {geo.points.map((p) => {
          const ep = episodes[p.index];
          const label = tv("E{ep} · {rating}", { ep: p.episode_number, rating: p.rating.toFixed(1) });
          return (
            <g key={p.index} onClick={() => ep && onPick(ep)}>
              <title>{ep?.name ? `${label} · ${ep.name}` : label}</title>
              {/* Fat transparent target so a point is tappable on touch */}
              <circle className="rating-hit" cx={p.x} cy={p.y} r={13} />
              <circle className="rating-dot" cx={p.x} cy={p.y} r={4} />
            </g>
          );
        })}

        {/* Episode-number ticks along the bottom */}
        {episodes.map((e, i) =>
          i % step === 0 || i === episodes.length - 1 ? (
            <text key={e.id} className="x-label" x={geo.xs[i]} y={H - 6}>
              {e.episode_number}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
