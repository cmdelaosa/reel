import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Search } from "lucide-react";
import { qk } from "@/lib/queryKeys";
import { useMedium } from "@/lib/medium";
import { usePrefetchTitle } from "@/lib/useOpenTitle";
import { searchMovies, searchShows } from "@/lib/tmdb";
import { searchGames } from "@/lib/igdb";
import { thumbArt } from "@/lib/artwork";
import { isEs, t as tr, tGenre } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";
import { WatchOn } from "@/ui/WatchOn";

/* ⌘K command palette — TMDB search via the edge proxy. Markup/classes ported
   from prototype/src/marquee.tsx Palette; data is live (debounced 300ms,
   min 2 chars). Recent searches (last 5) show while the query is empty.

   Busca en el medio en el que estés: series en TV, cine en Movies. No en los
   dos a la vez — una lista mezclada obligaría a mirar un glifo en cada fila
   para saber qué estás abriendo, y el conmutador ya dice en qué modo estás.
   Los recientes son comunes: "dune" es la misma palabra en los dos sitios. */

const RECENT_KEY = "reel.recentSearches";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function Palette({ onClose, onOpen }: {
  onClose: () => void;
  onOpen: (tmdbId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounced = useDebounced(q.trim(), 300);
  const [recent] = useState<string[]>(loadRecent);
  const prefetchTitle = usePrefetchTitle();
  const medium = useMedium();
  const movies = medium === "movie";
  const gamesMode = medium === "game";

  /* Tres medios, tres claves y tres buscadores. La clave no puede compartirse:
     un id solo es único dentro de su medio, y en juegos ni siquiera es de TMDB
     (0071). */
  const { data: results, isFetching } = useQuery({
    queryKey: gamesMode
      ? qk.gameSearch(debounced)
      : movies
        ? qk.movieSearch(debounced)
        : qk.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    queryFn: () =>
      gamesMode ? searchGames(debounced) : movies ? searchMovies(debounced) : searchShows(debounced),
  });

  useEffect(() => inputRef.current?.focus(), []);

  // Reset the selection whenever the query changes (render-time adjustment).
  const [selQuery, setSelQuery] = useState(debounced);
  if (selQuery !== debounced) {
    setSelQuery(debounced);
    setSel(0);
  }

  const rows = debounced.length >= 2 ? (results ?? []) : [];
  const selectedTmdbId = rows[sel]?.tmdb_id;

  // Solo series: lo que precarga es el detalle CON temporadas y episodios, que
  // en una película no existen — la ficha de cine se abre con una sola llamada.
  useEffect(() => {
    if (selectedTmdbId == null || movies || gamesMode) return;
    const timer = setTimeout(() => void prefetchTitle(selectedTmdbId), 150);
    return () => clearTimeout(timer);
  }, [selectedTmdbId, prefetchTitle, movies, gamesMode]);

  const open = (tmdbId: number) => {
    pushRecent(debounced);
    onOpen(tmdbId);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && rows[sel]) open(rows[sel].tmdb_id);
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="mq-pal sheet-x" onKeyDown={onKey} role="dialog" aria-modal="true" aria-label={tr(gamesMode ? "Search games" : movies ? "Search movies" : "Search shows")}>
        <div className="mq-pal-head">
          <Search size={17} className="mute" />
          {/* El rótulo nombra los TRES medios. El buscador ya buscaba juegos
              —searchGames, ahí arriba— pero seguía diciendo "Busca series…":
              esta línea y el aria-label de la hoja se escribieron cuando solo
              había dos modos, y nadie volvió a ellas cuando entró el tercero.
              Prometer series y devolver juegos es peor que no prometer nada. */}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr(gamesMode ? "Search games…" : movies ? "Search movies…" : "Search TV shows…")}
          />
          <kbd className="mq-kbd">esc</kbd>
        </div>
        <div className="mq-pal-list no-scrollbar">
          {debounced.length < 2 && recent.length > 0 && (
            <>
              {recent.map((r) => (
                <div key={r} className="mq-pal-row" onClick={() => setQ(r)}>
                  <Clock size={15} className="mute" style={{ margin: "0 10px" }} />
                  <div className="mq-pal-title" style={{ fontWeight: 600 }}>{r}</div>
                </div>
              ))}
            </>
          )}
          {debounced.length < 2 && recent.length === 0 && (
            <div className="mq-pal-empty">{tr("Type to search TMDB.")}</div>
          )}
          {debounced.length >= 2 && rows.length === 0 && (
            <div className="mq-pal-empty">
              {isFetching ? tr("Searching…") : `${tr("No results.")} (“${debounced}”)`}
            </div>
          )}
          {rows.map((r, i) => {
            const display = (isEs() && r.name_es) || r.name;
            return (
              <div
                key={r.id}
                className={`mq-pal-row ${i === sel ? "on" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => open(r.tmdb_id)}
              >
                {/* En juegos, `poster_path` es un hash de IGDB y no una ruta de
                    TMDB (0071): pasárselo a tmdbImg da una URL que responde 404
                    sin decir nada, y la fila sale sin carátula. thumbArt es la
                    misma elección que hacen el muro y el historial. */}
                {thumbArt(r.kind, r.poster_path) ? (
                  <img
                    className="mq-pal-art"
                    src={thumbArt(r.kind, r.poster_path)}
                    alt=""
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  <div className="mq-pal-art" style={{ background: posterBg(display) }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="mq-pal-title">{display}</div>
                  {/* The one place the original network keeps its text. Search
                      hits are upserted as partial rows (searchRow omits the
                      rich columns), so a show nobody has opened and nobody
                      follows carries no providers at all — dropping the network
                      here would leave the row saying strictly less than it did
                      before, at the moment you're deciding whether to add it.
                      Providers still render beside it when we happen to hold
                      them. */}
                  <div className="mq-pal-sub">
                    {[r.first_air_date?.slice(0, 4), r.genres.slice(0, 2).map(tGenre).join(" · "), r.network]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <WatchOn tmdbId={r.tmdb_id} />
                <ArrowRight size={14} className="mute" />
              </div>
            );
          })}
        </div>
        <div className="mq-pal-foot">
          <span><kbd className="mq-kbd">↑↓</kbd> {tr("navigate")}</span>
          <span><kbd className="mq-kbd">↵</kbd> {tr("open")}</span>
          {/* La atribución es del sitio de donde salen ESTOS resultados: los juegos
              no vienen de TMDB, y dejarlo puesto era acreditar a quien no ha
              puesto el dato. */}
          <span className="mute">{tr(gamesMode ? "IGDB via Reel proxy" : "TMDB via Reel proxy")}</span>
        </div>
      </div>
    </>
  );
}
