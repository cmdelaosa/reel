import { ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router";
import type { HistoryRow } from "@/lib/history";
import { tmdbImg } from "@/lib/tmdb";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
import { historyLines } from "@/domain/mediumCopy";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { posterBg } from "@/ui/posterBg";

/* One watched row in the history feed. Same visual grammar as the calendar's
   CalEpRow (.cal-ep), but the right slot shows the exact time it was marked
   watched instead of the air-date/check affordance.

   Desde 0069 el historial lleva los dos medios, y una película no tiene ni
   temporada ni episodio: donde una serie escribe "S02 · E07" y debajo el
   título del episodio, una película escribe su propio título y debajo el
   estudio. Lo que NO se hace es imprimirle "S01 · E01" al episodio sintético
   (0067): esa fila existe para que "vista" tenga dónde escribirse, no para
   leerse. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });

export function HistoryEpRow({ ep }: { ep: HistoryRow }) {
  const openShow = useOpenTitle();
  const [, setSearchParams] = useSearchParams();
  const art = tmdbImg(ep.poster_path, "w92");
  const esNames = useEsNames();
  const isMovie = ep.kind === "movie";
  // Qué va en cada línea lo decide domain/mediumCopy, que es donde está probado.
  const lines = historyLines(ep.kind);
  const showName = locName(esNames, ep.tmdb_id, ep.show_name, ep.kind);

  // Cada medio abre su propia ficha: ?movie= la de cine, ?title= la de series.
  const open = () => {
    if (!isMovie) return openShow(ep.tmdb_id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("movie", String(ep.tmdb_id));
      return next;
    });
  };

  return (
    <div className="cal-ep" onClick={open}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(showName) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill">
          <MediumGlyph kind={ep.kind} size={11} />
          <span className="truncate">{isMovie ? tr("Movie") : showName}</span>
          <ChevronRight size={12} style={{ flex: "0 0 auto" }} />
        </span>
        <div className="cal-ep-se truncate">
          {lines.headline === "title" ? showName : `S${pad2(ep.season_number)} · E${pad2(ep.episode_number)}`}
        </div>
        <div className="cal-ep-name mute truncate">
          {lines.caption === "studio" ? ep.network : ep.episode_name}
        </div>
      </div>
      <div className="cal-ep-right">
        <div className="cal-time">{fmtTime(ep.watched_at)}</div>
      </div>
    </div>
  );
}
