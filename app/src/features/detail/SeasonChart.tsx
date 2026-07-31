import { useState } from "react";
import { Star } from "lucide-react";
import type { EpisodeRow } from "@/lib/schemas";
import { t as tr, tv } from "@/lib/i18n";
import { chartGeometry, seasonImdbAverage } from "@/domain/episodeRatings";

/** "E7 · 8.8" — the hover readout, and each point's accessible name. */
const pointLabel = (episodeNumber: number, rating: number) =>
  tv("E{ep} · {rating}", { ep: episodeNumber, rating: rating.toFixed(1) });

/* Per-season IMDb episode-rating graph — a single hand-rolled SVG line (no chart
   dependency), theme-aware through the tokens. Plots IMDb ratings only, by
   design; TMDB's per-episode score sits on the episode sub-sheet. The season
   picker above the episode list drives which season is shown, so this component
   just renders whatever season it's handed. Tapping a point opens that episode's
   sub-sheet — the same action as its row below. Renders nothing until at least
   one episode in the season carries an IMDb rating. */

// viewBox units; the SVG scales to its container width (width:100%, height:auto).
const W = 680;
const H = 150;
// left is sized for the widest axis label, now "10" rather than "10.0".
const PAD = { top: 14, right: 14, bottom: 26, left: 26 };
const TIP_H = 18; // hover readout box, in viewBox units
const TIP_GAP = 9; // its distance from the dot

export function SeasonChart({ episodes, onPick }: { episodes: EpisodeRow[]; onPick: (e: EpisodeRow) => void }) {
  // Which point the pointer is on, by its slot index — the readout below shows
  // that episode's score without having to open it.
  const [hover, setHover] = useState<number | null>(null);
  const geo = chartGeometry(episodes, W, H, PAD);
  // Hooks run before this: a season that can't be charted still has to call them.
  if (!geo) return null;
  const avg = seasonImdbAverage(episodes);
  const hovered = geo.points.find((p) => p.index === hover) ?? null;

  // Label a handful of x positions (first, last, and a few between) so a long
  // season doesn't smear its episode numbers into an unreadable band. Pixel
  // positions come from geo.xs — chartGeometry owns the x scale.
  const step = Math.max(1, Math.ceil(episodes.length / 8));

  return (
    <div className="season-chart">
      <div className="season-chart-head">
        <div className="eyebrow">{tr("Episode ratings")}</div>
        {avg != null && (
          <div className="season-chart-agg" title={tr("Season average (IMDb)")}>
            <Star size={14} fill="currentColor" strokeWidth={0} />
            {avg.toFixed(1)}
            <span className="mute" style={{ fontWeight: 600, fontSize: 12 }}>IMDb</span>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          avg != null
            ? tv("IMDb episode ratings for this season, averaging {avg}", { avg: avg.toFixed(1) })
            : tr("IMDb episode ratings for this season")
        }
      >
        {/* Horizontal gridlines + their rating labels */}
        {geo.ticks.map((tick) => (
          <g key={tick.value}>
            <line className="grid-line" x1={PAD.left} y1={tick.y} x2={W - PAD.right} y2={tick.y} />
            {/* 0 / 5 / 10 — whole numbers on a fixed axis, so no decimals. */}
            <text className="grid-label" x={PAD.left - 6} y={tick.y} dominantBaseline="middle" textAnchor="end">
              {tick.value}
            </text>
          </g>
        ))}

        {/* The rating line, then the dots on top */}
        <path className="rating-line" d={geo.path} />
        {geo.points.map((p) => {
          const ep = episodes[p.index];
          return (
            <g
              key={p.index}
              aria-label={pointLabel(p.episode_number, p.rating)}
              onClick={() => ep && onPick(ep)}
              onMouseEnter={() => setHover(p.index)}
              onMouseLeave={() => setHover((h) => (h === p.index ? null : h))}
            >
              {/* Fat transparent target so a point is tappable on touch */}
              <circle className="rating-hit" cx={p.x} cy={p.y} r={13} />
              <circle className={`rating-dot${hover === p.index ? " on" : ""}`} cx={p.x} cy={p.y} r={4} />
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

        {/* Hover readout, drawn last so it sits above the line and dots. Inside
            the SVG rather than as an HTML overlay so it scales with the chart
            and needs no coordinate conversion. */}
        {hovered && (() => {
          const text = pointLabel(hovered.episode_number, hovered.rating);
          // No text metrics in SVG without measuring, so approximate from the
          // character count — the string is always "E<n> · <n.n>".
          const w = text.length * 6.2 + 14;
          const above = hovered.y - TIP_GAP - TIP_H > PAD.top;
          const y = above ? hovered.y - TIP_GAP - TIP_H : hovered.y + TIP_GAP;
          // Keep the box inside the plot even for the first and last episode.
          const x = Math.min(Math.max(hovered.x - w / 2, PAD.left), W - PAD.right - w);
          return (
            <g className="chart-tip" pointerEvents="none">
              <rect x={x} y={y} width={w} height={TIP_H} rx={5} />
              <text x={x + w / 2} y={y + TIP_H / 2} textAnchor="middle" dominantBaseline="central">
                {text}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
