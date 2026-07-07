import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Search } from "lucide-react";
import { qk } from "@/lib/queryKeys";
import { searchShows, tmdbImg } from "@/lib/tmdb";
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
      <div className="mq-pal sheet" onKeyDown={onKey}>
        <div className="mq-pal-head">
          <Search size={17} className="mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search shows on TMDB…"
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
            <div className="mq-pal-empty">Type at least 2 characters to search TMDB.</div>
          )}
          {debounced.length >= 2 && rows.length === 0 && (
            <div className="mq-pal-empty">
              {isFetching ? "Searching…" : `No matches for “${debounced}”.`}
            </div>
          )}
          {rows.map((t, i) => (
            <div
              key={t.id}
              className={`mq-pal-row ${i === sel ? "on" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => open(t.tmdb_id)}
            >
              {tmdbImg(t.poster_path, "w92") ? (
                <img className="mq-pal-art" src={tmdbImg(t.poster_path, "w92")} alt="" style={{ objectFit: "cover" }} />
              ) : (
                <div className="mq-pal-art" style={{ background: posterBg(t.name) }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="mq-pal-title">{t.name}</div>
                <div className="mq-pal-sub">
                  {[t.first_air_date?.slice(0, 4), t.genres.slice(0, 2).join(" · "), t.network]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <ArrowRight size={14} className="mute" />
            </div>
          ))}
        </div>
        <div className="mq-pal-foot">
          <span><kbd className="mq-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="mq-kbd">↵</kbd> open</span>
          <span className="mute">TMDB via Reel proxy</span>
        </div>
      </div>
    </>
  );
}
