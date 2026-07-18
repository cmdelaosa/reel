import { ChevronRight } from "lucide-react";
import type { HistoryRow } from "@/lib/history";
import { tmdbImg } from "@/lib/tmdb";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, locName, useEsNames } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";

/* One watched-episode row in the history feed. Same visual grammar as the
   calendar's CalEpRow (.cal-ep), but the right slot shows the exact time the
   episode was marked watched instead of the air-date/check affordance. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });

export function HistoryEpRow({ ep }: { ep: HistoryRow }) {
  const open = useOpenTitle();
  const art = tmdbImg(ep.poster_path, "w92");
  const esNames = useEsNames();
  const showName = locName(esNames, ep.tmdb_id, ep.show_name);

  return (
    <div className="cal-ep" onClick={() => open(ep.tmdb_id)}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(showName) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill">{showName}<ChevronRight size={12} /></span>
        <div className="cal-ep-se">S{pad2(ep.season_number)} · E{pad2(ep.episode_number)}</div>
        <div className="cal-ep-name mute">{ep.episode_name}</div>
      </div>
      <div className="cal-ep-right">
        <div className="cal-time">{fmtTime(ep.watched_at)}</div>
      </div>
    </div>
  );
}
