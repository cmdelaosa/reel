import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, LayoutGrid, List, Plus, Star, X } from "lucide-react";
import { useTrending, usePopular, usePopularNow, useTopRated, usePopularWithFriends } from "@/lib/explore";
import { useFriendships } from "@/lib/friends";
import { useLibrary, useFollow, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { Rail } from "@/ui";
import { FriendStack, type FriendLike } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";
import { useTitleIntent } from "@/lib/useOpenTitle";

/* Trending rail (ranked) + a single tabbed discover section: Popular now,
   Top rated, and With friends share one header, filter row, view toggle and
   pager — you pick which pool to browse. Each keeps 18 cards per page with the
   arrows and the genre/year filters. */

function TitlePoster({ t, rank, score, onOpen, onIgnore }: { t: TitleRow; rank?: number; score?: number | null; onOpen: () => void; onIgnore?: () => void }) {
  const art = tmdbImg(t.poster_path);
  const intent = useTitleIntent(t.tmdb_id);
  return (
    <div className="poster" style={{ background: posterBg(t.name) }} onClick={onOpen} {...intent}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      {rank != null && <span className="mq-rank">{rank}</span>}
      {score != null && score > 0 && (
        <span className="badge badge-glass absolute" style={{ top: 8, left: 8, zIndex: 3 }}>
          <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} /> {score.toFixed(1)}
        </span>
      )}
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

/* Small "who follows this" row shown under friend-tab cards. */
function FriendRow({ friends, count }: { friends: FriendLike[]; count: number }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <FriendStack fans={friends} size={20} />
      <span className="mute" style={{ fontSize: 12 }}>{count} {count === 1 ? "friend" : "friends"}</span>
    </div>
  );
}

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1970 + 1 }, (_, i) => THIS_YEAR - i);

/* First-air-year bound picker, shared by the discover tabs. */
function YearSelect({ value, onChange, label }: { value: number | null; onChange: (y: number | null) => void; label: string }) {
  return (
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
}

/* Cards shown per page, constant across tabs. The arrows page through the
   ranked pool PAGE_SIZE at a time. */
const PAGE_SIZE = 18;

/* Discover view mode (mosaic of posters vs compact rows), persisted so the
   choice sticks across visits. */
type ViewMode = "mosaic" | "list";
const VIEW_KEY = "reel.exploreView";
const loadView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "mosaic"; }
  catch { return "mosaic"; }
};

/* List-view row: same data as TitlePoster, in the app's mq-row shape. Shows the
   friend stack when this is a friend-tab card, otherwise the TMDB score. */
function TitleListRow({ t, score, friends, friendCount, onOpen, onIgnore }: { t: TitleRow; score?: number | null; friends?: FriendLike[] | null; friendCount?: number; onOpen: () => void; onIgnore: () => void }) {
  const art = tmdbImg(t.poster_path, "w92");
  const intent = useTitleIntent(t.tmdb_id);
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(t.name) }}>
        {art && <img src={art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
        {friends && friends.length > 0 ? (
          <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
            <FriendStack fans={friends} size={20} />
            <span className="mute" style={{ fontSize: 12 }}>{friendCount} {friendCount === 1 ? "friend" : "friends"}</span>
          </div>
        ) : (
          <div className="mute truncate" style={{ fontSize: 12.5, marginTop: 3 }}>
            {[t.first_air_date?.slice(0, 4), ...t.genres.slice(0, 2)].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      {score != null && score > 0 && (
        <span className="mq-score" style={{ fontSize: 15, flex: "0 0 auto" }}>
          <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)", verticalAlign: "-1px" }} /> {score.toFixed(1)}
        </span>
      )}
      <div style={{ flex: "0 0 auto", width: 96 }} onClick={(e) => e.stopPropagation()}>
        <AddButton t={t} />
      </div>
      <button
        className="btn btn-icon"
        title="Not interested — hide from suggestions"
        aria-label={`Hide ${t.name} from suggestions`}
        onClick={(e) => { e.stopPropagation(); onIgnore(); }}
      >
        <EyeOff size={15} />
      </button>
    </div>
  );
}

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

/* Shared genre taxonomy for the discover filters. Names double as the client-
   side match key (Popular/With-friends) and map to TMDB genre ids for the
   server-side Top-rated query. Subset of the proxy's TV_GENRES: no Soap/Reality
   (always hidden) and no News/Talk (noise on a discover surface). */
const GENRES: Record<string, number> = {
  "Action & Adventure": 10759, "Animation": 16, "Comedy": 35, "Crime": 80,
  "Documentary": 99, "Drama": 18, "Family": 10751, "Kids": 10762,
  "Mystery": 9648, "Sci-Fi & Fantasy": 10765, "War & Politics": 10768, "Western": 37,
};
const GENRE_NAMES = Object.keys(GENRES);

type Tab = "popular" | "rated" | "friends";
const TABS: { key: Tab; label: string }[] = [
  { key: "popular", label: "Popular now" },
  { key: "rated", label: "Top rated" },
  { key: "friends", label: "Popular with friends" },
];

/* Normalised discover card: a title plus the per-tab extras (TMDB score on the
   Top-rated tab, the friend stack on the With-friends tab). */
type DiscoverItem = { t: TitleRow; score: number | null; friends: FriendLike[] | null; friendCount: number };

export function DiscoverSections() {
  const { data: trendingRaw = [] } = useTrending();
  const { data: library = [] } = useLibrary();
  const { data: friendships = [] } = useFriendships();
  const { isIgnored, ignored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();

  const [tab, setTab] = useState<Tab>("popular");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [fromYear, setFromYear] = useState<number | null>(null);
  const [toYear, setToYear] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<ViewMode>(loadView);
  const switchView = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* session-only */ }
  };

  const hasFriends = friendships.filter((f) => f.status === "accepted").length >= 1;

  // Data pools, one per tab. Popular's grid is dual-mode: with no year range it
  // shows "Popular now" (recent/imminent premieres); picking a year falls back
  // to the classic catalog query. Top-rated filters year+genre server-side;
  // With-friends filters client-side (the RPC takes no params).
  const catalogMode = fromYear != null || toYear != null;
  const { data: popularNowRaw = [] } = usePopularNow(!catalogMode);
  const { data: catalogRaw = [] } = usePopular(fromYear, toYear, catalogMode);
  const genreIds = selectedGenres.map((g) => GENRES[g]).filter(Boolean);
  const { data: ratedRaw = [] } = useTopRated(fromYear, toYear, genreIds);
  const { data: friendsRaw = [] } = usePopularWithFriends(hasFriends);

  const [, setSearchParams] = useSearchParams();

  const goTab = (t: Tab) => { setTab(t); setPage(0); };
  const toggleGenre = (g: string) => {
    setSelectedGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
    setPage(0);
  };
  const changeYear = (set: (y: number | null) => void) => (y: number | null) => { set(y); setPage(0); };
  const hasFilters = selectedGenres.length > 0 || fromYear != null || toYear != null;
  const clearFilters = () => { setSelectedGenres([]); setFromYear(null); setToYear(null); setPage(0); };

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  // Discovery surface: everywhere drop what you already follow or have hidden.
  const followed = new Set(library.map((r) => r.tmdb_id));
  const passesGenre = (genres: string[]) => selectedGenres.length === 0 || genres.some((g) => selectedGenres.includes(g));
  const passesYear = (date: string | null) => {
    if (fromYear == null && toYear == null) return true;
    const y = date ? Number(date.slice(0, 4)) : null;
    if (y == null) return false;
    if (fromYear != null && y < fromYear) return false;
    if (toYear != null && y > toYear) return false;
    return true;
  };

  // Ignored suggestions never surface anywhere in Explore.
  const trending = trendingRaw.filter((t) => !isIgnored(t.tmdb_id));

  let items: DiscoverItem[];
  if (tab === "popular") {
    items = (catalogMode ? catalogRaw : popularNowRaw)
      .filter((t) => !isIgnored(t.tmdb_id) && !followed.has(t.tmdb_id) && passesGenre(t.genres))
      .map((t) => ({ t, score: null, friends: null, friendCount: 0 }));
  } else if (tab === "rated") {
    // Year + genre already applied server-side.
    items = ratedRaw
      .filter((t) => !isIgnored(t.tmdb_id) && !followed.has(t.tmdb_id))
      .map((t) => ({ t, score: t.vote_average, friends: null, friendCount: 0 }));
  } else {
    items = friendsRaw
      // Need the title id to add/hide the card; skip pre-0035 rows that lack it.
      .filter((p) => p.id != null && !isIgnored(p.tmdb_id) && !followed.has(p.tmdb_id) && passesGenre(p.genres) && passesYear(p.first_air_date))
      .map((p) => ({
        t: {
          id: p.id!, tmdb_id: p.tmdb_id, kind: "tv", name: p.name, overview: null,
          poster_path: p.poster_path, backdrop_path: null, first_air_date: p.first_air_date,
          status: null, genres: p.genres, network: p.network, episode_run_time: null,
          vote_average: p.vote_average, popularity: null,
        },
        score: null,
        friends: p.friends.map((f) => ({ id: f.id, name: f.name, avatarUrl: f.avatar_url })),
        friendCount: p.count,
      }));
  }

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1); // clamp when the pool shrinks
  const visible = items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const subtitle = tab === "popular"
    ? (catalogMode ? "Most popular for the selected years" : "New shows and fresh seasons, ranked by buzz")
    : tab === "rated"
      ? "The best of the catalog, ranked by TMDB score"
      : "Shows your friends follow";
  const emptyMsg = tab === "popular"
    ? "No popular shows match these filters."
    : tab === "rated"
      ? "No top-rated shows match these filters."
      : hasFriends
        ? "No shows from your friends match these filters."
        : "Add a friend to see what they're watching.";

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
          <div className="segmented scroll no-scrollbar" role="tablist" aria-label="Discover">
            {TABS.map((tb) => (
              <div
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                className={`seg ${tab === tb.key ? "seg-active" : ""}`}
                onClick={() => goTab(tb.key)}
              >
                {tb.label}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5" style={{ marginLeft: "auto" }}>
            <div className="flex items-center gap-1.5" role="group" aria-label="Pagination">
              <span className="mute" style={{ fontSize: 12.5 }}>{current + 1} / {pageCount}</span>
              <button className="chip" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
                <ChevronLeft size={14} />
              </button>
              <button className="chip" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="View mode">
              <button
                className={`chip ${view === "mosaic" ? "chip-active" : ""}`}
                onClick={() => switchView("mosaic")}
                title="Mosaic view"
                aria-pressed={view === "mosaic"}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className={`chip ${view === "list" ? "chip-active" : ""}`}
                onClick={() => switchView("list")}
                title="List view"
                aria-pressed={view === "list"}
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>
        <p className="mute" style={{ fontSize: 13, margin: "-8px 0 0" }}>{subtitle}</p>

        <div className="flex items-center gap-3 flex-wrap">
          <GenreDropdown options={GENRE_NAMES} selected={selectedGenres} onToggle={toggleGenre} />
          <div className="flex items-center gap-2.5 flex-wrap" style={{ marginLeft: "auto" }}>
            <YearSelect value={fromYear} onChange={changeYear(setFromYear)} label="From:" />
            <YearSelect value={toYear} onChange={changeYear(setToYear)} label="To:" />
            {hasFilters && (
              <button className="chip" onClick={clearFilters} title="Clear all filters">
                <X size={13} />
                Clear filters
              </button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{emptyMsg}</p>
        ) : view === "list" ? (
          <div className="flex flex-col gap-2">
            {visible.map((it) => (
              <TitleListRow
                key={it.t.tmdb_id}
                t={it.t}
                score={it.score}
                friends={it.friends}
                friendCount={it.friendCount}
                onOpen={() => open(it.t.tmdb_id)}
                onIgnore={() => ignore.mutate(it.t.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
            {visible.map((it) => (
              <div key={it.t.tmdb_id} className="flex flex-col gap-1.5">
                <TitlePoster t={it.t} score={it.score} onOpen={() => open(it.t.tmdb_id)} onIgnore={() => ignore.mutate(it.t.id)} />
                {it.friends && it.friends.length > 0 && <FriendRow friends={it.friends} count={it.friendCount} />}
                <AddButton t={it.t} />
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
