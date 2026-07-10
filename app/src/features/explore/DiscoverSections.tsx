import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, Plus, X } from "lucide-react";
import { useTrending, usePopular, usePopularNow } from "@/lib/explore";
import { useLibrary, useFollow, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { Rail } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* Trending rail (ranked) + a "Popular tv shows" grid with genre chips and a
   first-air-year range filter, + hide (ignore) a suggestion. */

function TitlePoster({ t, rank, onOpen, onIgnore }: { t: TitleRow; rank?: number; onOpen: () => void; onIgnore?: () => void }) {
  const art = tmdbImg(t.poster_path);
  return (
    <div className="poster" style={{ background: posterBg(t.name) }} onClick={onOpen}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      {rank != null && <span className="mq-rank">{rank}</span>}
      {onIgnore && (
        <button
          className="btn btn-icon badge-glass absolute"
          style={{ top: 8, right: 8, color: "#fff", zIndex: 3 }}
          title="Not interested — hide from suggestions"
          aria-label={`Hide ${t.name} from suggestions`}
          onClick={(e) => { e.stopPropagation(); onIgnore(); }}
        >
          <EyeOff size={15} />
        </button>
      )}
      <div className="poster-body">
        <div className="poster-title">{t.name}</div>
        <div className="poster-sub">{[t.first_air_date?.slice(0, 4), t.genres[0]].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

function AddButton({ t }: { t: TitleRow }) {
  const { data: library = [] } = useLibrary();
  const follow = useFollow();
  const unfollow = useUnfollow();
  const entry = library.find((r) => r.tmdb_id === t.tmdb_id);
  const added = Boolean(entry);
  return (
    <button
      className={`btn btn-sm ${added ? "btn-accent" : "btn-outline"}`}
      style={{ width: "100%" }}
      onClick={(e) => {
        e.stopPropagation();
        if (added && entry) unfollow.mutate(entry.title_id);
        else follow.mutate(t);
      }}
    >
      {added ? <><Check size={14} />Added</> : <><Plus size={14} />Add</>}
    </button>
  );
}

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1970 + 1 }, (_, i) => THIS_YEAR - i);

/* Multi-select genre dropdown: pick any number of genres via checkboxes. Empty
   selection means "all". Closes on outside click. */
function GenreDropdown({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (g: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const label = selected.length === 0 ? "All genres" : selected.length === 1 ? selected[0] : `${selected.length} genres`;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={`chip ${selected.length ? "chip-active" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="filter-menu">
          {options.map((g) => (
            <label key={g} className="filter-opt">
              <input type="checkbox" checked={selected.includes(g)} onChange={() => onToggle(g)} />
              <span>{g}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiscoverSections() {
  const { data: trendingRaw = [] } = useTrending();
  const { data: library = [] } = useLibrary();
  const { isIgnored, ignored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [fromYear, setFromYear] = useState<number | null>(null);
  const [toYear, setToYear] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Dual-mode grid: with no year range it shows "Popular now" (recent/imminent
  // season premieres); picking a year falls back to the classic catalog query.
  const catalogMode = fromYear != null || toYear != null;
  const { data: popularNowRaw = [] } = usePopularNow(!catalogMode);
  const { data: catalogRaw = [] } = usePopular(fromYear, toYear, catalogMode);
  const popularRaw = catalogMode ? catalogRaw : popularNowRaw;
  const [, setSearchParams] = useSearchParams();

  const toggleGenre = (g: string) =>
    setSelectedGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  const hasFilters = selectedGenres.length > 0 || fromYear != null || toYear != null;
  const clearFilters = () => { setSelectedGenres([]); setFromYear(null); setToYear(null); };

  // Ignored suggestions never surface anywhere in Explore.
  const trending = trendingRaw.filter((t) => !isIgnored(t.tmdb_id));

  // Discover grid = popular shows you neither follow nor ignore.
  const followed = new Set(library.map((r) => r.tmdb_id));
  const popular = popularRaw.filter((t) => !isIgnored(t.tmdb_id) && !followed.has(t.tmdb_id));
  const genres = [...new Set(popular.flatMap((t) => t.genres))].sort();
  const filtered = selectedGenres.length === 0
    ? popular
    : popular.filter((t) => t.genres.some((g) => selectedGenres.includes(g)));

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const yearSelect = (value: number | null, onChange: (y: number | null) => void, label: string) => (
    <label className="flex items-center gap-1.5">
      <span className="mute" style={{ fontSize: 13 }}>{label}</span>
      <select
        className="year-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Any</option>
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  );

  return (
    <>
      {trending.length > 0 && (
        <section className="flex flex-col gap-4">
          <Rail title="Trending this week" subtitle="What everyone's watching, via TMDB">
            {trending.map((t, i) => (
              <div key={t.tmdb_id} style={{ width: "var(--rail-pw)" }}>
                <TitlePoster t={t} rank={i + 1} onOpen={() => open(t.tmdb_id)} />
              </div>
            ))}
          </Rail>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">{catalogMode ? "Popular tv shows" : "Popular now"}</h2>
            <p className="mute" style={{ fontSize: 13 }}>
              {catalogMode ? "Most popular for the selected years" : "New shows and fresh seasons, ranked by buzz"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <GenreDropdown options={genres} selected={selectedGenres} onToggle={toggleGenre} />
          <div className="flex items-center gap-2.5 flex-wrap" style={{ marginLeft: "auto" }}>
            {yearSelect(fromYear, setFromYear, "From:")}
            {yearSelect(toYear, setToYear, "To:")}
            {hasFilters && (
              <button className="chip" onClick={clearFilters} title="Clear all filters">
                <X size={13} />
                Clear filters
              </button>
            )}
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>No popular shows match these filters.</p>
        ) : (
          <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
            {filtered.map((t) => (
              <div key={t.tmdb_id} className="flex flex-col gap-1.5">
                <TitlePoster t={t} onOpen={() => open(t.tmdb_id)} onIgnore={() => ignore.mutate(t.id)} />
                <AddButton t={t} />
              </div>
            ))}
          </div>
        )}

        {ignored.length > 0 && (
          <div className="flex flex-col gap-3">
            <button
              className="chip"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setShowHidden((v) => !v)}
              aria-expanded={showHidden}
            >
              <EyeOff size={13} />
              {ignored.length} hidden {ignored.length === 1 ? "show" : "shows"}
              {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHidden && (
              <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
                {ignored.map((t) => {
                  const art = tmdbImg(t.posterPath);
                  return (
                    <div key={t.titleId} className="poster" style={{ background: posterBg(t.name) }} onClick={() => open(t.tmdbId)}>
                      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
                      <div className="poster-sheen" />
                      <button
                        className="btn btn-icon badge-glass absolute"
                        style={{ top: 8, right: 8, color: "#fff", zIndex: 3 }}
                        title="Restore to suggestions"
                        aria-label={`Restore ${t.name} to suggestions`}
                        onClick={(e) => { e.stopPropagation(); unignore.mutate(t.titleId); }}
                      >
                        <Eye size={15} />
                      </button>
                      <div className="poster-body">
                        <div className="poster-title">{t.name}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
