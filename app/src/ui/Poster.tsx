import { Pause, Star } from "lucide-react";
import type { TitleCard } from "@/domain/types";
import { externalScore, scoreColor, scoreLabel } from "@/domain/externalScore";
import { steamReviewColor, steamReviewLabel } from "@/domain/steamReviews";
import { SteamIcon } from "@/ui/icons/SteamIcon";
import type { Medium } from "@/lib/medium";
import { posterBg } from "@/ui/posterBg";
import { WatchOn } from "@/ui/WatchOn";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { locName, t as tr, tGenre, tSteam, tv, useEsNames } from "@/lib/i18n";

/** Cuántas carátulas de una rejilla `.poster-grid` se piden sin diferir.
 *
 *  Es una COTA, no una medida: la rejilla es `auto-fill`, así que el número
 *  real depende del ancho de la ventana y calcularlo obligaría a medir antes de
 *  pintar. Doce cubre la primera pantalla en un portátil ancho y se pasa de
 *  unas pocas en un móvil — y pasarse es barato: una imagen de más que se pide
 *  pronto, contra una fila visible que llega tarde. */
export const EAGER_POSTERS = 12;

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle, showProviders = true, kind = "tv", rank, onClick, prefetchTmdbId, priority = false }: {
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
  /** Para las carátulas que ya se ven al cargar la página. `loading="lazy"` no
   *  es gratis en ellas: el navegador no pide una imagen diferida hasta tener
   *  el layout, así que la primera fila —la que el usuario está mirando— se
   *  ponía a la cola detrás de todo. Quien la marca es la rejilla, que es la
   *  única que sabe cuántas caben; esto solo obedece. */
  priority?: boolean;
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

  /* La insignia: la nota de IMDb si la fila la trae, la de TMDB si no. La regla
     y el color viven en domain/externalScore — aquí no se decide nada, solo se
     pinta. Una carátula sin `imdbRating` (los juegos, o una serie o película
     que IMDb no puntúa) sale con la de TMDB, que es la reserva.

     La etiqueta se calla en los juegos: ahí `voteAverage` no es de TMDB sino de
     IGDB, y decir "TMDB" sobre la nota de otro catálogo sería mentir en el
     único sitio donde nadie puede comprobarlo. */
  const score = externalScore({ imdb_rating: t.imdbRating, vote_average: t.voteAverage });
  const scoreFrom = score && kind !== "game" ? scoreLabel(score.source) : undefined;

  /* Y en un juego, ADEMÁS, el porcentaje de reseñas de Steam cuando la fila lo
     trae. Va junto a la de IGDB y no en su lugar porque no dicen lo mismo: una
     es la nota de un catálogo y la otra es lo que opina quien se lo ha jugado,
     que es lo que la gente mira antes de comprar.

     Lleva el logotipo en vez de una estrella para que las dos insignias no se
     confundan de un vistazo — dos estrellas con dos números distintos sobre la
     misma carátula serían un acertijo—, y el número va sin decimales porque es
     un porcentaje, no una nota sobre diez. El color y la etiqueta salen de
     domain/steamReviews; aquí no se decide nada. */
  const steam = kind === "game" && t.steamReviews?.count ? t.steamReviews : null;
  const steamLabel = steamReviewLabel(steam);

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
      {/* Los dos atributos se escriben SIEMPRE, con su valor por defecto en el
          caso que no los necesita (`eager` es el defecto del navegador, `auto`
          el de fetchPriority). Escribir uno u otro según el caso deja al
          navegador y al DOM decidiendo sobre un atributo que a veces está y a
          veces no; así el <img> tiene la misma forma en los dos caminos y lo
          único que cambia entre ellos son los valores, que es lo que la prueba
          de al lado puede leer sin ambigüedad. */}
      {t.posterPath && (
        <img
          className="poster-img"
          src={t.posterPath}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      )}
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
        {/* `flex-wrap` por la insignia de Steam: un juego abandonado puede
            llevar tres (pausa, IGDB y Steam) y en una carátula de móvil no
            caben en una línea. La carátula recorta lo que se sale
            (`overflow: hidden`), así que sin esto la tercera desaparecía a
            medias en vez de bajar a la línea de abajo. */}
        <span className="flex flex-wrap items-center justify-end gap-1">
          {t.stopped && (
            <span className="badge badge-glass" title={tr("Stopped watching")}>
              <Pause size={11} fill="currentColor" strokeWidth={0} />
            </span>
          )}
          {score && (
            <span className="badge badge-glass" title={scoreFrom}>
              <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: scoreColor(score.source) }} />
              {score.value.toFixed(1)}
            </span>
          )}
          {steam && (
            <span
              className="badge badge-glass"
              data-testid="steam-badge"
              title={steamLabel ? `Steam · ${tSteam(steamLabel)}` : "Steam"}
            >
              <SteamIcon size={11} style={{ color: steamReviewColor(steam.percent) }} />
              {steam.percent}%
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
