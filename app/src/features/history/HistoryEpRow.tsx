import { ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router";
import type { HistoryRow } from "@/lib/history";
import { thumbArt } from "@/lib/artwork";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
import { historyLines, mediumLabel } from "@/domain/mediumCopy";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { posterBg } from "@/ui/posterBg";

/* One watched row in the history feed. Same visual grammar as the calendar's
   CalEpRow (.cal-ep), but the right slot shows the exact time it was marked
   watched instead of the air-date/check affordance.

   Desde 0069 el historial lleva los tres medios (los juegos, desde 0074), y ni
   una película ni un juego tienen temporada ni episodio: donde una serie
   escribe "S02 · E07" y debajo el título del episodio, ellos escriben su propio
   título y debajo el estudio. Lo que NO se hace es imprimirles "S01 · E01" al
   episodio sintético (0067, 0071): esa fila existe para que "vista" —"terminado"
   en un juego— tenga dónde escribirse, no para leerse. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });

export function HistoryEpRow({ ep }: { ep: HistoryRow }) {
  const openShow = useOpenTitle();
  const [, setSearchParams] = useSearchParams();
  // La carátula de un juego es un hash de IGDB, no una ruta de TMDB (0071).
  const art = thumbArt(ep.kind, ep.poster_path);
  const esNames = useEsNames();
  const isEpisodic = ep.kind === "tv";
  // Qué va en cada línea lo decide domain/mediumCopy, que es donde está probado.
  const lines = historyLines(ep.kind);
  const showName = locName(esNames, ep.tmdb_id, ep.show_name, ep.kind);

  // Cada medio abre su propia ficha: ?title= la de series, ?movie= la de cine y
  // ?game= la de juegos, que además lleva un id de IGDB y no de TMDB.
  const open = () => {
    if (isEpisodic) return openShow(ep.tmdb_id);
    const param = ep.kind === "movie" ? "movie" : "game";
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(param, String(ep.tmdb_id));
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
        {/* En una serie la píldora lleva el nombre del programa, porque la línea
            grande es un episodio DE algo. En los otros dos la línea grande ya es
            el título, así que la píldora dice de qué medio se trata — que es lo
            único que ahí no se repite. */}
        <span className="cal-showpill">
          <MediumGlyph kind={ep.kind} size={11} />
          <span className="truncate">
            {isEpisodic ? showName : tr(mediumLabel(ep.kind))}
          </span>
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
