import { Check, Star, X } from "lucide-react";
import type { EpisodeRow } from "@/lib/schemas";
import { fmtAirDateLong } from "@/lib/region";
import { t as tr, tv } from "@/lib/i18n";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Episode sub-sheet — a small card over the detail sheet with everything the
   dense row can't hold: the synopsis (TMDB) and the episode's rating from BOTH
   sources (TMDB · IMDb), plus mark-watched. Opened by tapping an episode row or
   a point on the season graph. Escape/backdrop are owned by the parent detail
   sheet (which renders this), matching how its poster lightbox is handled. */

function Score({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div className="ratings-cell" style={{ flex: 1 }}>
      <div className="eyebrow">{label}</div>
      <div className="ratings-value">
        <Star size={16} fill="currentColor" strokeWidth={0} style={{ color }} />
        <span>{value != null ? value.toFixed(1) : "—"}</span>
      </div>
    </div>
  );
}

export function EpisodeSheet({
  episode,
  aired,
  watched,
  busy,
  onToggleWatched,
  onClose,
}: {
  episode: EpisodeRow;
  aired: boolean;
  watched: boolean;
  busy: boolean;
  onToggleWatched: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const meta = [
    episode.air_datetime ? fmtAirDateLong(episode.air_datetime) : tr("TBA"),
    episode.runtime ? `${episode.runtime} ${tr("min")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="backdrop" style={{ zIndex: 80 }} onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={tv("Episode S{season} · E{episode}", {
          season: episode.season_number,
          episode: episode.episode_number,
        })}
        tabIndex={-1}
        className="sheet-center fixed z-[81] card ep-sheet"
        style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
      >
        <div className="ep-sheet-body">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                S{episode.season_number} · E{episode.episode_number}
              </div>
              <h3 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", margin: 0 }}>
                {episode.name ?? tv("Episode {n}", { n: episode.episode_number })}
              </h3>
              {meta && <div className="mute" style={{ fontSize: 13, marginTop: 4 }}>{meta}</div>}
            </div>
            <button className="btn btn-icon" aria-label={tr("Close")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* Per-episode scores from both sources */}
          <div className="ep-sheet-scores">
            <Score label="TMDB" value={episode.tmdb_vote_average} color="var(--accent)" />
            <div className="ratings-divider" />
            <Score label="IMDb" value={episode.imdb_rating} color="var(--imdb)" />
          </div>

          {episode.overview ? (
            <p className="ep-sheet-overview">{episode.overview}</p>
          ) : (
            <p className="ep-sheet-overview" style={{ fontStyle: "italic" }}>{tr("No synopsis yet.")}</p>
          )}

          {aired && (
            <button
              className={`btn ${watched ? "btn-outline" : "btn-accent"}`}
              disabled={busy}
              onClick={onToggleWatched}
            >
              <Check size={16} />
              {watched ? tr("Watched — tap to clear") : tr("Mark watched")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
