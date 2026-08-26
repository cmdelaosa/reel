import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMovieLibrary, type LibraryMovie } from "@/lib/library";
import type { MovieStatus } from "@/domain/movieStatus";
import { locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { tmdbImg } from "@/lib/tmdb";
import { Poster, TabMenu } from "@/ui";
import { PosterGridSkeleton } from "@/ui/Skeleton";

/* Tu cine — la rejilla de la biblioteca con sus cubos. Gemela de ShowsPage, y
   deliberadamente la misma rejilla, los mismos chips y el mismo strip de orden:
   es la misma pregunta ("¿qué tengo?") en el otro medio.

   Cuatro cubos donde las series tienen siete. Los que faltan no se han
   simplificado, es que no pueden existir: "Viendo" y "Al día" describen un
   progreso parcial que un acto único no tiene, y "Abandonadas" tampoco —
   una peli no se deja a medias (decisión de producto, 23-ago-2026). */

type Bucket = MovieStatus | "all";

const FILTERS: { key: Bucket; label: string }[] = [
  { key: "watchlist", label: "Not started" },
  { key: "upcoming", label: "Upcoming" },
  { key: "watched", label: "Watched" },
  { key: "all", label: "All" },
];

type SortKey = "lastreleased" | "added" | "az" | "rating";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "lastreleased", label: "Last released" },
  { key: "added", label: "Date added" },
  { key: "az", label: "A–Z" },
  { key: "rating", label: "Top rated" },
];

/* "Último estrenado" por defecto, por lo mismo que en "Sin empezar" de series:
   de un montón de cosas que no has visto, lo que quieres arriba es lo nuevo.
   Aquí vale para todos los cubos, porque ninguno tiene un "último visto" que
   ordene mejor — verlas es un solo acto y la mitad de la lista no lo tiene. */
const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
const COMPARATORS: Record<SortKey, (a: LibraryMovie, b: LibraryMovie) => number> = {
  lastreleased: (a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""),
  added: (a, b) => ms(b.added_at) - ms(a.added_at),
  az: (a, b) => a.name.localeCompare(b.name),
  rating: (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
};

export default function MoviesPage() {
  const { data: movies = [], isPending } = useMovieLibrary();
  const [sort, setSort] = useState<SortKey>("lastreleased");
  const [searchParams, setSearchParams] = useSearchParams();
  const esNames = useEsNames();

  /* El cubo vive en la URL, igual que en ShowsPage y por el mismo motivo: la
     pestaña de la barra enlaza a un cubo concreto, y desde la propia página eso
     es una navegación a la misma ruta que un estado local ignoraría. */
  const param = searchParams.get("filter");
  const f: Bucket = FILTERS.some((x) => x.key === param) ? (param as Bucket) : "watchlist";
  const setF = (key: Bucket) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", key);
        return next;
      },
      { replace: true },
    );

  const count = (key: Bucket) =>
    key === "all" ? movies.length : movies.filter((m) => m.status === key).length;
  const items = movies
    .filter((m) => f === "all" || m.status === f)
    .sort(COMPARATORS[sort]);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("movie", String(tmdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("My Movies")}</h1>

      <div className="mq-toolbar">
        <div className="shows-buckets flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {tr(x.label)}
              <span className="mute" style={{ fontWeight: 700 }}>{count(x.key)}</span>
            </button>
          ))}
        </div>
        <TabMenu
          value={f}
          options={FILTERS.map((x) => ({ key: x.key, label: tr(x.label), hint: String(count(x.key)) }))}
          onPick={setF}
          menuLabel={tr("My Movies")}
        />
        <div className="segmented scroll no-scrollbar">
          {SORTS.map((s) => (
            <div key={s.key} className={`seg ${sort === s.key ? "seg-active" : ""}`} onClick={() => setSort(s.key)}>
              {tr(s.label)}
            </div>
          ))}
        </div>
        <TabMenu
          value={sort}
          options={SORTS.map((s) => ({ key: s.key, label: tr(s.label) }))}
          onPick={setSort}
          menuLabel={tr("Sort")}
          align="end"
        />
      </div>

      {isPending && <PosterGridSkeleton />}

      {!isPending && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {f === "all"
              ? tr("No movies yet — hit {key} and add one.")
                  .split("{key}")
                  .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))
              : tv("Nothing in {filter} right now.", { filter: tr(FILTERS.find((x) => x.key === f)?.label ?? "") })}
          </p>
        </div>
      )}

      <div className="poster-grid">
        {items.map((m) => (
          <Poster
            key={m.title_id}
            kind="movie"
            t={{
              id: String(m.tmdb_id),
              name: locName(esNames, m.tmdb_id, m.name, "movie"),
              year: m.first_air_date?.slice(0, 4) ?? "TBA",
              genres: m.genres.length ? m.genres : ["—"],
              posterPath: tmdbImg(m.poster_path),
              voteAverage: m.vote_average ?? 0,
              imdbRating: m.imdb_rating,
            }}
            onClick={() => open(m.tmdb_id)}
          />
        ))}
      </div>
    </div>
  );
}
