import { Star } from "lucide-react";
import type { TitleCard } from "@/domain/types";
import { posterBg } from "@/ui/posterBg";
import { NetworkLogo } from "@/ui/NetworkLogo";

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle, showNetwork = true, onClick }: {
  t: TitleCard;
  subtitle?: string;
  showNetwork?: boolean;
  onClick?: () => void;
}) {
  const progress = t.progress ?? 0;
  const showProgress = progress > 0 && progress < 100;

  return (
    <div className="poster" style={{ background: posterBg(t.name) }} onClick={onClick}>
      {t.posterPath && <img className="poster-img" src={t.posterPath} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      <div className="poster-top">
        {showNetwork ? <NetworkLogo network={t.network} /> : <span />}
        {t.voteAverage > 0 && (
          <span className="badge badge-glass">
            <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
            {t.voteAverage.toFixed(1)}
          </span>
        )}
      </div>
      <div className="poster-body">
        <div className="poster-title">{t.name}</div>
        <div className="poster-sub">{subtitle ?? `${t.genres[0]} · ${t.year}`}</div>
      </div>
      {showProgress && (
        <div className="pbar">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
