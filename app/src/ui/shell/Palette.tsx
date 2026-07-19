import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Search } from "lucide-react";
import { qk } from "@/lib/queryKeys";
import { usePrefetchTitle } from "@/lib/useOpenTitle";
import { searchShows, tmdbImg } from "@/lib/tmdb";
import { isEs, t as tr, tGenre } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";

/* ⌘K command palette — TMDB search via the edge proxy. Markup/classes ported
   from prototype/src/marquee.tsx Palette; data is live (debounced 300ms,
   min 2 chars). Recent searches (last 5) show while the query is empty. */

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

  const { data: results, isFetching } = useQuery({
    queryKey: qk.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    queryFn: () => searchShows(debounced),
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

  useEffect(() => {
    if (selectedTmdbId == null) return;
    const timer = setTimeout(() => void prefetchTitle(selectedTmdbId), 150);
    return () => clearTimeout(timer);
  }, [selectedTmdbId, prefetchTitle]);

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
      <div className="mq-pal sheet" onKeyDown={onKey} role="dialog" aria-modal="true" aria-label={tr("Search shows")}>
        <div className="mq-pal-head">
          <Search size={17} className="mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("Search TV shows…")}
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
                {tmdbImg(r.poster_path, "w92") ? (
                  <img className="mq-pal-art" src={tmdbImg(r.poster_path, "w92")} alt="" style={{ objectFit: "cover" }} />
                ) : (
                  <div className="mq-pal-art" style={{ background: posterBg(display) }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="mq-pal-title">{display}</div>
                  <div className="mq-pal-sub">
                    {[r.first_air_date?.slice(0, 4), r.genres.slice(0, 2).map(tGenre).join(" · "), r.network]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <ArrowRight size={14} className="mute" />
              </div>
            );
          })}
        </div>
        <div className="mq-pal-foot">
          <span><kbd className="mq-kbd">↑↓</kbd> {tr("navigate")}</span>
          <span><kbd className="mq-kbd">↵</kbd> {tr("open")}</span>
          <span className="mute">{tr("TMDB via Reel proxy")}</span>
        </div>
      </div>
    </>
  );
}
