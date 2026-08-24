import { useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import type { LibraryGame } from "@/lib/library";
import { igdbImg } from "@/lib/igdb";
import { formatPlaytime } from "@/domain/gameStatus";
import { formatRelease, isReleased } from "@/domain/gameRelease";
import { isEs, t as tr } from "@/lib/i18n";
import { airTimeZone } from "@/lib/region";
import { dayOffset } from "@/domain/calendar";
import { posterBg } from "@/ui/posterBg";

/* Una fila de lanzamiento de un juego. Prima de CalEpRow y de MovieReleaseRow,
   con la misma anatomía —carátula, píldora, línea grande, y a la derecha la
   cuenta atrás— y una diferencia que lo cambia todo a la derecha.

   ── La cuenta atrás solo existe cuando hay un día ─────────────────────────
   En series y en cine la fecha es siempre un día concreto, así que "faltan 12
   días" siempre se puede escribir. En juegos no: IGDB fecha la mitad del
   catálogo por trimestre o por año (0071), y `release_precision` dice cuál es
   cuál. Restar días a un "Q4 2027" da un número exacto sobre un día que nadie
   ha prometido — el 31 de diciembre que la migración guarda para poder ordenar.

   Así que la derecha tiene dos formas y no una: con precisión de día, la cuenta
   atrás de siempre; con cualquier otra, el periodo escrito tal cual ("Q4 2027")
   y ningún número. Es la misma regla que formatRelease sostiene para el texto,
   aplicada al hueco donde más fácil sería saltársela.

   ── La píldora dice la plataforma ─────────────────────────────────────────
   En cine la píldora dice DÓNDE aterriza (cines o casa), porque la misma
   película sale dos veces. En juegos la pregunta equivalente es en qué juegas:
   un lanzamiento que no llega a tu consola no es tu lanzamiento. */

export function GameReleaseRow({ g, now, periodNamedAbove = false }: {
  g: LibraryGame;
  now: Date;
  /** True cuando la fila va debajo de un separador que YA nombra el periodo —
   *  el feed de Lanzamientos agrupa por él. Sin esto, un juego de Q4 2027 salía
   *  con "Q4 2027" en el separador y "Q4 2027" otra vez a su derecha, dos
   *  renglones más abajo. En Esta noche no hay separador, así que la fila lo
   *  dice ella y esto se queda en false. */
  periodNamedAbove?: boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  const es = isEs();
  const art = igdbImg(g.poster_path, "cover_small");

  const exactDay = g.release_precision === "day";
  /* isReleased y no un `date <= hoy` escrito aquí: con una fecha ancha solo
     cuenta como salido cuando el periodo ENTERO ha pasado, y con precisión
     desconocida o 'tbd' no cuenta nunca. Esa cautela está razonada y probada en
     el dominio; repetirla a mano era la forma de que un día dijeran cosas
     distintas. */
  const released = isReleased(g.first_air_date, g.release_precision, now.toISOString().slice(0, 10));
  const label = formatRelease(g.first_air_date, g.release_precision, { es });

  const platforms = g.platforms ?? [];
  const where = platforms.length === 0
    ? tr("Game")
    : platforms.length > 2
      ? `${platforms[0]} +${platforms.length - 1}`
      : platforms.join(" · ");

  const open = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("game", String(g.tmdb_id));
      return next;
    });

  return (
    <div className="cal-ep" onClick={open}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(g.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill">
          <span className="truncate">{where}</span>
          <ChevronRight size={12} style={{ flex: "0 0 auto" }} />
        </span>
        <div className="cal-ep-se truncate">{g.name}</div>
        <div className="cal-ep-name mute truncate">
          {[g.genres.slice(0, 2).join(" · "), g.network].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="cal-ep-right">
        {released ? (
          /* Ya salió: lo que interesa no es la fecha sino cuánto le has echado.
             Un juego salido y con cero horas dice "0 h", que es exactamente la
             información por la que está en esta lista. */
          <div className="cal-time">{formatPlaytime(g.minutes_played ?? 0)}</div>
        ) : exactDay && g.first_air_date ? (
          <>
            <div className="cal-days">
              {dayOffset(`${g.first_air_date}T00:00:00Z`, now, airTimeZone())}
              <span>{tr("days")}</span>
            </div>
            <div className="cal-when mute">{label}</div>
          </>
        ) : periodNamedAbove ? null : (
          /* Sin día exacto no hay número. "Q4 2027" a secas dice todo lo que la
             fuente dijo, y ni un día más. */
          <div className="cal-when mute" style={{ fontWeight: 700 }}>{label}</div>
        )}
      </div>
    </div>
  );
}
