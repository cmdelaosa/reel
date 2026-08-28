import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMyRatings, type RatedRow } from "@/lib/ratings";
import { thumbArt } from "@/lib/artwork";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { MEDIA, sheetParam, type Medium } from "@/domain/tasteScope";
import { mediumPlural } from "@/domain/mediumCopy";
import {
  RATE_SORTS,
  ratingsEmpty,
  ratingsRoute,
  ratingsSummaryLine,
  ratingsTitle,
  sortRatings,
  type RateSort,
} from "@/domain/ratingsList";
import { Stars } from "@/ui";
import { RowsSkeleton } from "@/ui/Skeleton";
import { posterBg } from "@/ui/posterBg";

/* Tus notas de UN medio, con su pantalla propia: /you/ratings/shows, /movies y
   /games (las rutas, en domain/ratingsList).

   Antes esto era la última sección del perfil, una lista sola con un filtro de
   medio, debajo del muro y del mapa de calor — o sea, a un par de pantallas de
   scroll de la única puerta que llevaba a ella. Con 1.460 notas, de las cuales
   1.005 son de cine importadas de FilmAffinity, esa lista es lo más grande que
   tiene el perfil y era lo último que se veía.

   Ahora el perfil enseña TRES tarjetas —una por medio, con su cuenta y su
   media— y cada una abre esto. Cambia dos cosas de fondo: el perfil vuelve a
   caber en una pantalla y media, y "mis notas de cine" pasa a ser un sitio con
   URL, que se puede guardar y compartir.

   La ruta cuelga de /you y no de /movies o /games a propósito: tus notas son
   tuyas, no del modo en el que estés, y colgarlas del prefijo de un medio haría
   que abrirlas cambiara el acento y las pestañas de la barra (lib/medium,
   `mediumOfPath`). Es la misma decisión que ya tienen el perfil, el historial y
   Amigos. */

/* Treinta por página, el doble de las quince que enseñaba el perfil. Allí la
   lista compartía sitio con todo lo demás; aquí es la pantalla entera, y con
   1.005 notas de cine la diferencia entre quince y treinta son 34 páginas en
   vez de 67. Más no: el pasador es «anterior / siguiente», así que la página
   tiene que seguir siendo algo que se recorre de un vistazo. */
const RATE_PAGE = 30;

function ratedAtLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return tr("today");
  if (days === 1) return tr("yesterday");
  if (days < 30) return tv("{days} days ago", { days });
  return new Date(iso).toLocaleDateString(dateLocale(), { month: "short", year: "numeric" });
}

function RatingRow({ r, onOpen }: { r: RatedRow; onOpen: () => void }) {
  const t = r.titles;
  /* La carátula sale de una fuente distinta según el medio: un juego guarda un
     hash de IGDB donde series y cine guardan una ruta de TMDB (0071). thumbArt
     lo resuelve; tmdbImg a secas devolvía una URL bien formada que responde 404
     sin quejarse — o sea, todas tus notas de juegos sin carátula y ni un error
     en consola que lo explicara. */
  const art = thumbArt(t.kind, t.poster_path);
  const esNames = useEsNames();
  const name = locName(esNames, t.tmdb_id, t.name, t.kind);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate" style={{ marginTop: 0 }}>{name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? ""), `${tr("rated")} ${ratedAtLabel(r.created_at)}`].filter(Boolean).join(" · ")}
        </div>
        <div style={{ marginTop: 4 }}><Stars score={r.score} size={13} /></div>
      </div>
      {/* Aquí no va el glifo del medio que llevaba la lista del perfil: allí las
          filas eran de los tres y la carátula de un juego y la de una película
          se parecen; en esta pantalla el medio ya lo dice el título. */}
      <div className="mq-score">{r.score}<span>/10</span></div>
    </div>
  );
}

export default function RatingsPage({ medium }: { medium: Medium }) {
  const { data: ratings = [], isPending } = useMyRatings();
  const [sort, setSort] = useState<RateSort>("new");
  /* La página se guarda como "la página N DE ESTE medio", no como un número
     suelto. Cambiar de medio con el conmutador de arriba es navegar a otra ruta,
     pero el componente es el mismo y ocupa el mismo sitio del árbol, así que
     React le conserva el estado: sin esto, ir de la página 2 de tus 44 películas
     a tus juegos te dejaba en su "página 2 de 2" —el final de la lista— sin
     haber pedido nada de eso. Medido en local con 44 notas de cine y 33 de
     juegos. Es el mismo truco que el menú «···» de la barra usa para cerrarse al
     navegar (ui/shell/TopTabs), y por lo mismo: sin un efecto que mire la ruta
     para llamar a setState.
     El ORDEN sí cruza: elegir "Mejor nota" es una intención tuya, no una
     posición dentro de una lista concreta. */
  const [pageAt, setPageAt] = useState<{ medium: Medium; n: number }>({ medium, n: 0 });
  const page = pageAt.medium === medium ? pageAt.n : 0;
  const setPage = (n: number) => setPageAt({ medium, n });
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /* El filtro por medio. En positivo —`=== medium`, nunca `!==` el otro—, que
     es la regla de la casa (domain/tasteScope, domain/mediumCopy): el medio que
     llegue el año que viene no se cuela en la lista de otro por un `!==` que
     nadie se acordó de tocar. A mano y no con `ofMedium` porque el medio de una
     nota no está en la fila sino en el título que trae colgado. */
  const mine = useMemo(() => ratings.filter((r) => r.titles.kind === medium), [ratings, medium]);
  const rows = useMemo(() => sortRatings(mine, sort), [mine, sort]);
  const avg = mine.length > 0 ? mine.reduce((n, r) => n + r.score, 0) / mine.length : null;

  const pageCount = Math.max(1, Math.ceil(rows.length / RATE_PAGE));
  const clamped = Math.min(page, pageCount - 1);
  const start = clamped * RATE_PAGE;
  const shown = rows.slice(start, start + RATE_PAGE);

  /* Cada fila se abre con el parámetro de SU medio: `?title=` sobre una película
     llevaba a la ficha de la serie con ese número —o a ninguna—, porque el id
     solo es único dentro de su medio (domain/tasteScope, `sheetParam`). Lo
     recoge el Shell, que pinta las tres fichas desde cualquier pantalla. */
  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(sheetParam(medium), String(tmdbId));
      return next;
    });

  /* El conmutador de arriba a la derecha. Enseña los medios de los que TIENES
     notas, más el que estás mirando aunque esté vacío —si no, la pantalla en la
     que estás no aparecería en su propio conmutador—. Existe para que estas tres
     pantallas no sean callejones sin salida: sin él, pasar de tus notas de cine
     a las de juegos es volver al perfil y buscar la otra tarjeta. */
  const otros = useMemo(() => {
    const con = new Set(ratings.map((r) => r.titles.kind));
    return MEDIA.filter((m) => m === medium || con.has(m));
  }, [ratings, medium]);

  return (
    <div className="screen mq-page">
      <div className="mq-sechead">
        <div>
          <h1 className="section-title">{tr(ratingsTitle(medium))}</h1>
          {mine.length > 0 && (
            <div className="mute" style={{ fontSize: 12.5 }}>
              {tv(ratingsSummaryLine(medium, mine.length), {
                n: mine.length.toLocaleString(),
                avg: avg!.toFixed(1),
              })}
            </div>
          )}
        </div>
        {otros.length > 1 && (
          <div className="segmented scroll no-scrollbar">
            {otros.map((m) => (
              <div
                key={m}
                className={`seg ${m === medium ? "seg-active" : ""}`}
                onClick={() => m !== medium && navigate(ratingsRoute(m))}
              >
                {tr(mediumPlural(m))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Los cuatro órdenes solo si hay algo que ordenar: sobre una lista vacía
          son cuatro botones que no hacen nada encima de la frase que explica
          cómo llenarla. Fuera del árbol y no con `hidden`, que aquí no esconde
          nada: `.mq-rate-toolbar` trae su propio `display: flex` y gana. */}
      {rows.length > 0 && (
        <div className="mq-rate-toolbar">
          <div className="segmented scroll no-scrollbar">
            {RATE_SORTS.map((s) => (
              <div
                key={s.key}
                className={`seg ${sort === s.key ? "seg-active" : ""}`}
                onClick={() => { setSort(s.key); setPage(0); }}
              >
                {tr(s.label)}
              </div>
            ))}
          </div>
          <span className="mute" style={{ fontSize: 12.5 }}>
            {start + 1}–{Math.min(start + RATE_PAGE, rows.length)} {tr("of")} {rows.length}
          </span>
        </div>
      )}

      {/* El esqueleto y no el vacío mientras carga: son mil y pico notas que
          llegan paginadas de cien en cien (lib/paging), y sin esto la pantalla
          abría diciendo "aún no has puntuado nada" durante ese rato. */}
      {isPending && <RowsSkeleton count={6} />}

      {!isPending && rows.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr(ratingsEmpty(medium))}</p>
        </div>
      )}

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
        {shown.map((r) => (
          <RatingRow key={r.id} r={r} onOpen={() => open(r.titles.tmdb_id)} />
        ))}
      </div>

      {pageCount > 1 && (
        <div className="mq-pager">
          <button
            className="btn btn-ghost btn-sm"
            disabled={clamped === 0}
            style={{ opacity: clamped === 0 ? 0.4 : 1, pointerEvents: clamped === 0 ? "none" : "auto" }}
            onClick={() => setPage(clamped - 1)}
          >
            <ChevronLeft size={15} />{tr("Prev")}
          </button>
          <span>{tr("Page")} {clamped + 1} {tr("of")} {pageCount}</span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={clamped === pageCount - 1}
            style={{ opacity: clamped === pageCount - 1 ? 0.4 : 1, pointerEvents: clamped === pageCount - 1 ? "none" : "auto" }}
            onClick={() => setPage(clamped + 1)}
          >
            {tr("Next")}<ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
