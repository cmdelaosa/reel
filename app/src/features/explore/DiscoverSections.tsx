import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, List, Plus, SlidersHorizontal, Star, X } from "lucide-react";
import { useTrending, usePopular, usePopularNow, useTopRated, usePopularWithFriends } from "@/lib/explore";
import { useFriendships } from "@/lib/friends";
import { useLibrary, useFollow, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { isEs, locName, t as tr, tv, tGenre, useEsNames } from "@/lib/i18n";
import { Rail, TabMenu } from "@/ui";
import { PosterGridSkeleton, RailCardsSkeleton, RowsSkeleton } from "@/ui/Skeleton";
import { FriendStack, type FriendLike } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Trending rail (ranked) + a single tabbed discover section: Popular now,
   Top rated, and With friends share one toolbar row — pool tabs on the left,
   a Filters chip (genres + year range in an anchored popover on desktop, a
   bottom sheet on phones) and the mosaic/list toggle on the right. Active
   filters echo as removable chips under the toolbar, and the grid grows in
   PAGE_SIZE steps via a "Show more" button instead of a pager, up to the
   MAX_ITEMS ceiling every tab shares. */

function TitlePoster({ t, rank, score, onOpen, onIgnore }: { t: TitleRow; rank?: number; score?: number | null; onOpen: () => void; onIgnore?: () => void }) {
  const art = tmdbImg(t.poster_path);
  const intent = useTitleIntent(t.tmdb_id);
  const esNames = useEsNames();
  const name = (isEs() && t.name_es) || locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="poster" style={{ background: posterBg(name) }} onClick={onOpen} {...intent}>
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
          className="btn btn-icon badge-glass absolute disc-hide"
          style={{ top: 8, right: 8, color: "#fff", zIndex: 3 }}
          title={tr("Ignore — hide from suggestions")}
          aria-label={tv("Hide {name} from suggestions", { name: t.name })}
          onClick={(e) => { e.stopPropagation(); onIgnore(); }}
        >
          <EyeOff size={15} />
        </button>
      )}
      <div className="poster-body">
        <div className="poster-title">{name}</div>
        <div className="poster-sub">{[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? "")].filter(Boolean).join(" · ")}</div>
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
      {added ? <><Check size={14} />{tr("Added")}</> : <><Plus size={14} />{tr("Add")}</>}
    </button>
  );
}

/* Small "who follows this" row shown under friend-tab cards. */
function FriendRow({ friends, count }: { friends: FriendLike[]; count: number }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <FriendStack fans={friends} size={20} />
      <span className="mute" style={{ fontSize: 12 }}>{count} {count === 1 ? tr("friend") : tr("friends")}</span>
    </div>
  );
}

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1970 + 1 }, (_, i) => THIS_YEAR - i);

/* First-air-year bound picker inside the filters panel: label stacked over the
   select so From/To sit side by side. */
function YearField({ value, onChange, label }: { value: number | null; onChange: (y: number | null) => void; label: string }) {
  return (
    <label className="disc-yearfield">
      <span className="mute" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <select
        className="year-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{tr("Any")}</option>
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  );
}

/* Cards revealed per "Show more" press, constant across tabs. */
const PAGE_SIZE = 18;

/* Hard ceiling on a tab's pool: three "Show more" pages. Every tab browses the
   same fixed depth, so the button always disappears after the third press. The
   friend tab (and a heavily filtered pool) can hold fewer — this is a cap, not
   a quota. */
const MAX_ITEMS = 3 * PAGE_SIZE;

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
  const esNames = useEsNames();
  const name = (isEs() && t.name_es) || locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
        {friends && friends.length > 0 ? (
          <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
            <FriendStack fans={friends} size={20} />
            <span className="mute" style={{ fontSize: 12 }}>{friendCount} {friendCount === 1 ? tr("friend") : tr("friends")}</span>
          </div>
        ) : (
          <div className="mute truncate" style={{ fontSize: 12.5, marginTop: 3 }}>
            {[t.first_air_date?.slice(0, 4), ...t.genres.slice(0, 2).map(tGenre)].filter(Boolean).join(" · ")}
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
        title={tr("Ignore — hide from suggestions")}
        aria-label={tv("Hide {name} from suggestions", { name: t.name })}
        onClick={(e) => { e.stopPropagation(); onIgnore(); }}
      >
        <EyeOff size={15} />
      </button>
    </div>
  );
}

/* Combined filters panel behind the Filters chip: genre checkboxes (empty
   selection means "all") plus the year range, with a Clear footer. One markup,
   two shapes via CSS — anchored glass popover ≥768px, bottom sheet below.
   Closes on Escape here; backdrop tap (mobile) and outside click (desktop)
   are handled by the anchor wrapper. */
function FilterPanel({ selected, onToggleGenre, fromYear, toYear, onFromYear, onToYear, hasFilters, onClear, onClose }: {
  selected: string[];
  onToggleGenre: (g: string) => void;
  fromYear: number | null;
  toYear: number | null;
  onFromYear: (y: number | null) => void;
  onToYear: (y: number | null) => void;
  hasFilters: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div className="backdrop disc-sheet-backdrop" onClick={onClose} />
      <div ref={ref} className="disc-panel" role="dialog" aria-modal="true" aria-label={tr("Filters")} tabIndex={-1}>
        <div className="disc-handle" aria-hidden />
        <div className="disc-sec-label">{tr("Genres")}</div>
        <div className="disc-genres">
          {GENRE_NAMES.map((g) => (
            <label key={g} className="filter-opt">
              <input type="checkbox" checked={selected.includes(g)} onChange={() => onToggleGenre(g)} />
              <span>{tGenre(g)}</span>
            </label>
          ))}
        </div>
        <div className="disc-sec-label">{tr("Years")}</div>
        <div className="disc-years">
          <YearField value={fromYear} onChange={onFromYear} label={tr("From")} />
          <YearField value={toYear} onChange={onToYear} label={tr("To")} />
        </div>
        <div className="disc-panel-foot">
          <button className="chip" disabled={!hasFilters} onClick={onClear}>
            <X size={13} />
            {tr("Clear filters")}
          </button>
        </div>
      </div>
    </>
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
]; // labels run through tr() at render

/* Normalised discover card: a title plus the per-tab extras (TMDB score on the
   Top-rated tab, the friend stack on the With-friends tab). */
type DiscoverItem = { t: TitleRow; score: number | null; friends: FriendLike[] | null; friendCount: number };

export function DiscoverSections() {
  const { data: trendingRaw = [], isLoading: trendingLoading } = useTrending();
  const { data: library = [] } = useLibrary();
  const { data: friendships = [] } = useFriendships();
  const { isIgnored, ignored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();

  const [tab, setTab] = useState<Tab>("popular");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [fromYear, setFromYear] = useState<number | null>(null);
  const [toYear, setToYear] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  //
  // Each pool is gated on the tab that shows it, so opening Explore costs one
  // discover request instead of four fired at the same cold edge isolate. The
  // 1h staleTime means the second visit to a tab is instant.
  const catalogMode = fromYear != null || toYear != null;
  const popularNow = usePopularNow(tab === "popular" && !catalogMode);
  const catalog = usePopular(fromYear, toYear, tab === "popular" && catalogMode);
  const genreIds = selectedGenres.map((g) => GENRES[g]).filter(Boolean);
  const rated = useTopRated(fromYear, toYear, genreIds, tab === "rated");
  const friendsPool = usePopularWithFriends(hasFriends && tab === "friends");
  const popularNowRaw = popularNow.data ?? [];
  const catalogRaw = catalog.data ?? [];
  const ratedRaw = rated.data ?? [];
  const friendsRaw = friendsPool.data ?? [];

  // Whichever pool the visible tab draws from. `isLoading` (not `isPending`)
  // is what a skeleton wants: it stays false for a query that is merely
  // disabled, and false while placeholderData holds the previous grid on
  // screen through a filter change.
  const gridLoading =
    tab === "popular" ? (catalogMode ? catalog.isLoading : popularNow.isLoading)
    : tab === "rated" ? rated.isLoading
    : friendsPool.isLoading;

  const [, setSearchParams] = useSearchParams();

  // Any tab or filter change restarts the visible slice at one page.
  const goTab = (t: Tab) => { setTab(t); setShown(PAGE_SIZE); };
  const toggleGenre = (g: string) => {
    setSelectedGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
    setShown(PAGE_SIZE);
  };
  const changeYear = (set: (y: number | null) => void) => (y: number | null) => { set(y); setShown(PAGE_SIZE); };
  const hasFilters = selectedGenres.length > 0 || fromYear != null || toYear != null;
  const filterCount = selectedGenres.length + (fromYear != null || toYear != null ? 1 : 0);
  const clearFilters = () => { setSelectedGenres([]); setFromYear(null); setToYear(null); setShown(PAGE_SIZE); };
  const clearYears = () => { setFromYear(null); setToYear(null); setShown(PAGE_SIZE); };

  // Desktop popover: close on any click outside the chip + panel. On mobile the
  // panel is a fixed sheet whose backdrop intercepts those clicks instead.
  const filtersRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const h = (e: MouseEvent) => { if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [filtersOpen]);

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

  // Trim to the shared ceiling before paging so every tab tops out at the same
  // depth and "Show more" is spent in exactly three presses.
  items = items.slice(0, MAX_ITEMS);

  const visible = items.slice(0, shown);
  const yearChipLabel = fromYear != null && toYear != null
    ? `${fromYear} – ${toYear}`
    : fromYear != null
      ? `${tr("From")} ${fromYear}`
      : `${tr("To")} ${toYear}`;

  const emptyMsg = tr(
    tab === "popular"
      ? "No popular shows match these filters."
      : tab === "rated"
        ? "No top-rated shows match these filters."
        : hasFriends
          ? "No shows from your friends match these filters."
          : "Add a friend to see what they're watching.",
  );

  return (
    <>
      {(trendingLoading || trending.length > 0) && (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Trending this week")}>
            {trendingLoading
              ? <RailCardsSkeleton count={8} />
              : trending.map((t, i) => (
                  <div key={t.tmdb_id} style={{ width: "var(--rail-pw)" }}>
                    <TitlePoster t={t} rank={i + 1} onOpen={() => open(t.tmdb_id)} />
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
                onClick={() => goTab(tb.key)}
              >
                {tr(tb.label)}
              </div>
            ))}
          </div>
          <TabMenu
            value={tab}
            options={TABS.map((t) => ({ key: t.key, label: tr(t.label) }))}
            onPick={goTab}
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
                {filterCount > 0 && <span className="disc-count">{filterCount}</span>}
              </button>
              {filtersOpen && (
                <FilterPanel
                  selected={selectedGenres}
                  onToggleGenre={toggleGenre}
                  fromYear={fromYear}
                  toYear={toYear}
                  onFromYear={changeYear(setFromYear)}
                  onToYear={changeYear(setToYear)}
                  hasFilters={hasFilters}
                  onClear={clearFilters}
                  onClose={() => setFiltersOpen(false)}
                />
              )}
            </div>
            <button
              className={`chip chip-icon ${view === "list" ? "chip-active" : ""}`}
              onClick={() => switchView(view === "list" ? "mosaic" : "list")}
              title={tr("List view")}
              aria-label={tr("List view")}
              aria-pressed={view === "list"}
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {hasFilters && (
          <div className="disc-active">
            {selectedGenres.map((g) => (
              <button key={g} className="chip chip-active" onClick={() => toggleGenre(g)} aria-label={`${tr("Clear filters")}: ${tGenre(g)}`}>
                {tGenre(g)}
                <X size={12} />
              </button>
            ))}
            {(fromYear != null || toYear != null) && (
              <button className="chip chip-active" onClick={clearYears} aria-label={`${tr("Clear filters")}: ${yearChipLabel}`}>
                {yearChipLabel}
                <X size={12} />
              </button>
            )}
            <button className="chip" onClick={clearFilters}>{tr("Clear filters")}</button>
          </div>
        )}

        {gridLoading ? (
          // 104px = .mq-row's 78px art plus its padding and border.
          view === "list" ? <RowsSkeleton count={6} height={104} /> : <PosterGridSkeleton count={PAGE_SIZE} action />
        ) : visible.length === 0 ? (
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

        {gridLoading ? (
          // Hold the button's row as well. Every pool here runs deeper than one
          // page in practice, so it is all but certain to appear — and being the
          // last thing on the section, it was pushing Collections down 58px on
          // its own once the grid had stopped doing so.
          <div className="show-more">
            <div className="skeleton" style={{ height: "var(--ctl-h)", width: 128 }} />
          </div>
        ) : shown < items.length && (
          <div className="show-more">
            <button className="btn btn-outline" onClick={() => setShown((s) => s + PAGE_SIZE)}>
              {tr("Show more")}
            </button>
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
              {ignored.length} {ignored.length === 1 ? tr("hidden show") : tr("hidden shows")}
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
                        title={tr("Restore to suggestions")}
                        aria-label={tv("Restore {name} to suggestions", { name: t.name })}
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
