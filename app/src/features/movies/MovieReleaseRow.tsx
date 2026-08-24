import { useSearchParams } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import type { MovieRelease } from "@/lib/schemas";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { useMovieEpisodeIds } from "@/features/movies/data";
import { tmdbImg } from "@/lib/tmdb";
import { locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { airTimeZone, fmtAirDate } from "@/lib/region";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { dayOffset } from "@/domain/calendar";

/* Una fila de estreno, hermana de CalEpRow y con su misma anatomía: carátula,
   píldora, línea grande, y a la derecha o el check o la cuenta atrás.

   Lo que cambia es qué va en cada hueco. En una serie la píldora lleva el
   nombre del programa y la línea grande el episodio, porque lo que estás
   mirando es un episodio DE algo. En una película no hay un "de": la línea
   grande es la película y la píldora dice DÓNDE aterriza, que es la pregunta
   que de verdad distingue una fila de otra — la misma película aparece dos
   veces, un día en cines y otro en casa. */

export function MovieReleaseRow({ r, now }: { r: MovieRelease; now: Date }) {
  const [, setSearchParams] = useSearchParams();
  const esNames = useEsNames();
  const name = locName(esNames, r.tmdb_id, r.name, "movie");

  const past = new Date(r.release_at).getTime() < now.getTime();
  const days = dayOffset(r.release_at, now, airTimeZone());
  const art = tmdbImg(r.poster_path, "w92");
  const seen = r.watch_event_id != null;

  // El "visto" de una película es su episodio sintético (0067), y esta fila no
  // lo trae: rpc_movie_releases devuelve el evento de estreno, no el episodio.
  // Se resuelve por lotes, igual que los proveedores, para que una lista de
  // treinta estrenos no cueste treinta consultas.
  const { data: episodeIds } = useMovieEpisodeIds();
  const episodeId = episodeIds?.get(r.title_id) ?? null;
  const mark = useMarkWatched(r.title_id);
  const unmark = useUnmarkWatched(r.title_id);

  const open = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("movie", String(r.tmdb_id));
      return next;
    });

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (r.watch_event_id) unmark.mutate(r.watch_event_id);
    else if (episodeId) mark.mutate(episodeId);
  };

  const where =
    r.release_kind === "theatrical" ? tr("In theatres")
    : r.release_kind === "digital" ? tr("Streaming")
    : tr("Release");

  return (
    <div className="cal-ep" onClick={open}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(r.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill">
          <span className="truncate">{where}</span>
          <ChevronRight size={12} style={{ flex: "0 0 auto" }} />
        </span>
        <div className="cal-ep-se truncate">{name}</div>
        <div className="cal-ep-name mute">
          {[r.genres.slice(0, 2).join(" · "), r.runtime ? `${r.runtime} ${tr("min")}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="cal-ep-right">
        {past ? (
          <button
            className={`check ${seen ? "on" : ""}`}
            onClick={toggle}
            disabled={!seen && !episodeId}
            title={seen ? tr("Watched — tap to clear") : tv("Mark {name} watched", { name })}
            aria-label={seen ? tr("Watched — tap to clear") : tv("Mark {name} watched", { name })}
          >
            <Check size={15} strokeWidth={3} />
          </button>
        ) : (
          <>
            <div className="cal-days">{days}<span>{tr("days")}</span></div>
            <div className="cal-when mute">{fmtAirDate(r.release_at)}</div>
          </>
        )}
        {/* Solo en la fila de streaming: en la de cine los logos dirían "está en
            Netflix" junto a una fecha de sala, que es la confusión que las dos
            filas existen para deshacer. */}
        {r.release_kind === "digital" && <WatchOn tmdbId={r.tmdb_id} kind="movie" />}
      </div>
    </div>
  );
}
