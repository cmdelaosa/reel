import { Pause, Star } from "lucide-react";
import type { TitleCard } from "@/domain/types";
import type { Medium } from "@/lib/medium";
import { posterBg } from "@/ui/posterBg";
import { WatchOn } from "@/ui/WatchOn";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle, showProviders = true, kind = "tv", rank, onClick, prefetchTmdbId }: {
  t: TitleCard;
  subtitle?: string;
  /** Where-to-watch logos in the top-left slot. */
  showProviders?: boolean;
  /** El medio de `t.id` — decide de qué fila salen los logos (0067), de dónde
   *  sale el título en español, y si hay proveedores que enseñar. */
  kind?: Medium;
  /** Posición en un ranking, para los carruseles que la enseñan. */
  rank?: number;
  onClick?: () => void;
  prefetchTmdbId?: number;
}) {
  const progress = t.progress ?? 0;
  const showProgress = progress > 0 && progress < 100;
  const intent = useTitleIntent(prefetchTmdbId);
  // TitleCard.id is the tmdb id (stringified) — localize here so every grid
  // and rail gets Spanish titles for free.
  //
  // Un juego se queda con su nombre y no pasa por el mapa, y no es un atajo: el
  // mapa se indexa por `kind:id` (0067) porque un id solo es único dentro de su
  // medio, así que un juego pintado como serie —que es lo que hacía el defecto—
  // buscaba `tv:<id de IGDB>` y le ponía a un juego el título en español de la
  // serie que lleva ese número. Y buscar `game:<id>` tampoco acertaría nunca:
  // name_es lo llena tmdb-proxy (0046) y IGDB no tiene traducciones.
  const esNames = useEsNames();
  const name = kind === "game" ? t.name : locName(esNames, t.id, t.name, kind);

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
      {rank != null && <span className="mq-rank">{rank}</span>}
      <div className="poster-top">
        {/* TitleCard.id is the tmdb id as a string — the key providers are
            cached by. The wrapper always renders so the badges stay pinned
            right whether or not this title is available in your country. */}
        {/* Un juego no está "en Netflix": no hay proveedores que pedir, y el id
            que se pediría sería de IGDB contra una caché de TMDB. */}
        <span>
          {showProviders && kind !== "game" && <WatchOn tmdbId={Number(t.id) || null} kind={kind} />}
        </span>
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
