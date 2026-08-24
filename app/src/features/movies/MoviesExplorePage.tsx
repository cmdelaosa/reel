import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { SlidersHorizontal, X } from "lucide-react";
import { useMovieNowPlaying, useMoviePopular, useMovieTopRated, useMovieTrending } from "@/lib/movies";
import { useMovieLibrary } from "@/lib/library";
import { useIgnored } from "@/lib/ignore";
import { FilterPanel, TitlePoster } from "@/features/explore/DiscoverPieces";
import { t as tr, tGenre } from "@/lib/i18n";
import { Rail, TabMenu, useShowMore } from "@/ui";
import { PosterGridSkeleton, RailCardsSkeleton } from "@/ui/Skeleton";
import type { TitleRow } from "@/lib/schemas";

/* Explorar, en cine. Gemelo de DiscoverSections y con su misma planta: un
   carrusel de tendencias arriba, y debajo una barra de pestañas con filtros
   sobre una rejilla que crece a golpe de "Ver más".

   Las tres pestañas no son las mismas, y ahí está lo que cambia:
     · En cartelera ocupa el sitio de "Popular ahora". En series hay que deducir
       qué está pasando mirando estrenos de temporada; en cine, lo que está
       pasando es literalmente lo que hay en salas, y TMDB lo publica.
     · Populares y Mejor valoradas son las mismas preguntas del otro medio.
     · No hay "Popular entre amigos": esa se apoya en rpc_popular_with_friends,
       que cuenta episodios vistos por tu círculo. Su versión de cine llega con
       el muro compartido, en la siguiente rama.

   Los géneros son otra taxonomía: los ids de TMDB para cine no son los de
   series (10759 "Acción y aventura" no existe en cine, que lo parte en 28 y 12),
   así que la lista de abajo es propia y no un subconjunto de aquella. */

const GENRES: Record<string, number> = {
  "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
  "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
  "Horror": 27, "Mystery": 9648, "Romance": 10749, "Science Fiction": 878,
  "Thriller": 53, "War": 10752, "Western": 37,
};
const GENRE_NAMES = Object.keys(GENRES);

type Tab = "playing" | "popular" | "rated";
const TABS: { key: Tab; label: string }[] = [
  { key: "playing", label: "In theatres" },
  { key: "popular", label: "Popular" },
  { key: "rated", label: "Top rated" },
];

const PAGE_SIZE = 18;
const MAX_ITEMS = 3 * PAGE_SIZE;

export default function MoviesExplorePage() {
  const [, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("playing");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [fromYear, setFromYear] = useState<number | null>(null);
  const [toYear, setToYear] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const { data: trending = [], isLoading: trendingLoading } = useMovieTrending();
  const { data: movies = [] } = useMovieLibrary();
  const { isIgnored } = useIgnored();

  const genreIds = selectedGenres.map((g) => GENRES[g]).filter(Boolean);
  const hasFilters = selectedGenres.length > 0 || fromYear != null || toYear != null;

  /* Una consulta por pestaña, y solo la de la pestaña abierta: abrir Explorar
     cuesta una petición, no tres contra un edge frío. Igual que en series.
     "En cartelera" no admite filtros —es una lista cerrada, la de hoy en salas—
     así que al filtrar se cae a Populares, que es la misma pregunta con el
     catálogo entero detrás. */
  const filteringPlaying = tab === "playing" && hasFilters;
  const effectiveTab: Tab = filteringPlaying ? "popular" : tab;

  const playing = useMovieNowPlaying(effectiveTab === "playing");
  const popular = useMoviePopular(fromYear, toYear, effectiveTab === "popular");
  const rated = useMovieTopRated(fromYear, toYear, genreIds, effectiveTab === "rated");

  const loading =
    effectiveTab === "playing" ? playing.isLoading
    : effectiveTab === "popular" ? popular.isLoading
    : rated.isLoading;

  const followed = useMemo(() => new Set(movies.map((m) => m.tmdb_id)), [movies]);

  /* Fuera lo que ya tienes y lo que dijiste que no quieres ver. El género se
     filtra aquí en las pestañas que no lo mandan al servidor (solo Mejor
     valoradas lo hace), y por eso se compara contra los nombres que TMDB ya
     escribió en la fila. */
  const playingData = playing.data;
  const popularData = popular.data;
  const ratedData = rated.data;
  const items = useMemo(() => {
    const pool: TitleRow[] =
      effectiveTab === "playing" ? (playingData ?? [])
      : effectiveTab === "popular" ? (popularData ?? [])
      : (ratedData ?? []);
    const byGenre = (t: TitleRow) =>
      selectedGenres.length === 0 || selectedGenres.some((g) => t.genres.includes(g));
    return pool
      .filter((t) => !followed.has(t.tmdb_id) && !isIgnored(t.tmdb_id))
      .filter((t) => effectiveTab === "rated" || byGenre(t))
      .slice(0, MAX_ITEMS);
  }, [playingData, popularData, ratedData, followed, isIgnored, selectedGenres, effectiveTab]);

  const { shown, more } = useShowMore(items, PAGE_SIZE);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("movie", String(tmdbId));
      return next;
    });

  const clearFilters = () => {
    setSelectedGenres([]);
    setFromYear(null);
    setToYear(null);
  };
  const toggleGenre = (g: string) =>
    setSelectedGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const yearLabel =
    fromYear != null && toYear != null ? `${fromYear} – ${toYear}`
    : fromYear != null ? `${tr("From")} ${fromYear}`
    : toYear != null ? `${tr("To")} ${toYear}`
    : null;

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Explore")}</h1>

      {(trendingLoading || trending.length > 0) && (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Trending this week")}>
            {trendingLoading
              ? <RailCardsSkeleton count={8} />
              : trending.map((t, i) => (
                  <div key={t.tmdb_id} style={{ width: "var(--rail-pw)" }}>
                    <TitlePoster t={t} kind="movie" rank={i + 1} onOpen={() => open(t.tmdb_id)} />
                  </div>
                ))}
          </Rail>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="disc-toolbar">
          <div className="segmented scroll no-scrollbar" role="tablist" aria-label={tr("Discover")}>
            {TABS.map((tb) => (
              <div
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                className={`seg ${tab === tb.key ? "seg-active" : ""}`}
                onClick={() => setTab(tb.key)}
              >
                {tr(tb.label)}
              </div>
            ))}
          </div>
          <TabMenu
            value={tab}
            options={TABS.map((t) => ({ key: t.key, label: tr(t.label) }))}
            onPick={setTab}
            menuLabel={tr("Discover")}
          />
          <div className="disc-tools">
            <div className="disc-filters" ref={filtersRef}>
              <button
                className={`chip ${hasFilters ? "chip-active" : ""}`}
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
              >
                <SlidersHorizontal size={14} />
                {tr("Filters")}
                {selectedGenres.length > 0 && <span className="disc-count">{selectedGenres.length}</span>}
              </button>
              {filtersOpen && (
                <FilterPanel
                  genres={GENRE_NAMES}
                  selected={selectedGenres}
                  onToggleGenre={toggleGenre}
                  fromYear={fromYear}
                  toYear={toYear}
                  onFromYear={setFromYear}
                  onToYear={setToYear}
                  hasFilters={hasFilters}
                  onClear={clearFilters}
                  onClose={() => setFiltersOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            {selectedGenres.map((g) => (
              <button key={g} className="chip chip-active" onClick={() => toggleGenre(g)}>
                {tGenre(g)} <X size={12} />
              </button>
            ))}
            {yearLabel && (
              <button className="chip chip-active" onClick={() => { setFromYear(null); setToYear(null); }}>
                {yearLabel} <X size={12} />
              </button>
            )}
            {filteringPlaying && (
              <span className="mute" style={{ fontSize: 12.5 }}>
                {tr("Filters search the whole catalogue, not just what's in theatres.")}
              </span>
            )}
          </div>
        )}

        {loading && <PosterGridSkeleton />}

        {!loading && items.length === 0 && (
          <p className="dim" style={{ fontSize: 14, margin: 0 }}>{tr("No movies match these filters.")}</p>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {shown.map((t) => (
            <TitlePoster
              key={t.tmdb_id}
              t={t}
              kind="movie"
              score={effectiveTab === "rated" ? t.vote_average : null}
              onOpen={() => open(t.tmdb_id)}
            />
          ))}
        </div>

        {more}
      </section>
    </div>
  );
}
