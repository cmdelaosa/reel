import { Pause, Star } from "lucide-react";
import type { TitleCard } from "@/domain/types";
import { posterBg } from "@/ui/posterBg";
import { NetworkLogo } from "@/ui/NetworkLogo";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle, showNetwork = true, onClick, prefetchTmdbId }: {
  t: TitleCard;
  subtitle?: string;
  showNetwork?: boolean;
  onClick?: () => void;
  prefetchTmdbId?: number;
}) {
  const progress = t.progress ?? 0;
  const showProgress = progress > 0 && progress < 100;
  const intent = useTitleIntent(prefetchTmdbId);
  // TitleCard.id is the tmdb id (stringified) — localize here so every grid
  // and rail gets Spanish titles for free.
  const esNames = useEsNames();
  const name = locName(esNames, t.id, t.name);

  return (
    <div
      className="poster"
      style={{ background: posterBg(t.name) }}
      onClick={onClick}
      {...intent}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": tv("{name} — open details", { name }),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
            },
          }
        : {})}
    >
      {t.posterPath && <img className="poster-img" src={t.posterPath} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      <div className="poster-top">
        {showNetwork ? <NetworkLogo network={t.network} /> : <span />}
        <span className="flex items-center gap-1">
          {t.stopped && (
            <span className="badge badge-glass" title={tr("Stopped watching")}>
              <Pause size={11} fill="currentColor" strokeWidth={0} />
            </span>
          )}
          {t.voteAverage > 0 && (
            <span className="badge badge-glass">
              <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
              {t.voteAverage.toFixed(1)}
            </span>
          )}
        </span>
      </div>
      <div className="poster-body">
        <div className="poster-title">{name}</div>
        <div className="poster-sub">{subtitle ?? `${tGenre(t.genres[0])} · ${t.year}`}</div>
      </div>
      {showProgress && (
        <div className="pbar">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
