import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bell, CalendarClock, Check, ChevronLeft, ChevronRight, Clapperboard,
  Clock, Compass, Eye, Flame, LayoutGrid, Play, Plus, Search, Share2, Sliders, Star,
  Tv, User, Users,
} from "lucide-react";
import { Title, TITLES, GENRES, inStatus, ratedAtOf, ratedAtLabel, episodeFeed, FeedEp, CAL_TODAY, CAL_NOW } from "./data";
import { Poster, Stars, NetworkLogo, UICtx, useUI, posterBg } from "./components";
import { DetailSheet } from "./screens";
import { NotifPanel, DesignLab } from "./overlays";
import { WatchlistProvider, useWatchlist } from "./watchlist";

/* ============================================================
   MARQUEE — a second full shell. Top tab navigation (floating
   dock on mobile), bento home, ⌘K command palette. Same feature
   set as the classic shell, different architecture.
   ============================================================ */

type Tab = "tonight" | "shows" | "explore" | "calendar" | "you";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "tonight", label: "Tonight", icon: Clapperboard },
  { key: "shows", label: "Shows", icon: LayoutGrid },
  { key: "explore", label: "Explore", icon: Compass },
  { key: "calendar", label: "Calendar", icon: CalendarClock },
  { key: "you", label: "You", icon: User },
];

export default function Marquee() {
  const [tab, setTab] = useState<Tab>("tonight");
  const [detail, setDetail] = useState<string | null>(null);
  const [notif, setNotif] = useState(false);
  const [lab, setLab] = useState(false);
  const [palette, setPalette] = useState(false);

  /* ⌘K / Ctrl-K opens the palette from anywhere */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <WatchlistProvider>
    <UICtx.Provider value={{ open: setDetail }}>
      <div className="mq">
        {/* ---- Top bar ---- */}
        <header className="mq-top">
          <div className="mq-top-inner">
            <div className="mq-brand" onClick={() => setTab("tonight")}>
              <span className="mq-brand-ico"><Play size={14} fill="currentColor" strokeWidth={0} /></span>
              <span className="mq-brand-name">Reel</span>
            </div>

            <nav className="mq-tabs">
              {TABS.map((t) => (
                <button key={t.key} className={`mq-tab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
                  <t.icon size={16} />
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>

            <div className="mq-top-actions">
              <button className="mq-searchbtn" onClick={() => setPalette(true)}>
                <Search size={15} />
                <span className="mq-searchbtn-label">Search</span>
                <kbd className="mq-kbd">⌘K</kbd>
              </button>
              <button className="btn btn-ghost btn-icon relative" onClick={() => setNotif((v) => !v)}>
                <Bell size={18} />
                <span className="mq-belldot" />
              </button>
              <button className="btn btn-ghost btn-icon" title="Settings" onClick={() => setLab(true)}>
                <Sliders size={18} />
              </button>
              <button className="mq-avatar" title="Your profile" onClick={() => setTab("you")}>C</button>
            </div>
          </div>
        </header>

        {/* ---- Content ---- */}
        <main className="mq-main">
          {tab === "tonight" && <Tonight go={setTab} />}
          {tab === "shows" && <Shows />}
          {tab === "explore" && <Explore onSearch={() => setPalette(true)} />}
          {tab === "calendar" && <CalendarTab />}
          {tab === "you" && <You />}
        </main>

        {/* ---- Floating dock (mobile) ---- */}
        <nav className="mq-dock">
          {TABS.map((t) => (
            <button key={t.key} className={`mq-dockbtn ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)} title={t.label}>
              <t.icon size={19} />
              <span className="mq-docklabel">{t.label}</span>
            </button>
          ))}
        </nav>

        {/* ---- Overlays (same feature set as the classic shell) ---- */}
        {palette && <Palette onClose={() => setPalette(false)} onOpen={(id) => { setPalette(false); setDetail(id); }} />}
        {notif && <NotifPanel onClose={() => setNotif(false)} />}
        {detail && <DetailSheet id={detail} onClose={() => setDetail(null)} />}
        {lab && <DesignLab onClose={() => setLab(false)} />}
      </div>
    </UICtx.Provider>
    </WatchlistProvider>
  );
}

/* ============================================================
   Command palette — real search over the library (⌘K)
   ============================================================ */
function Palette({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return TITLES.slice(0, 7);
    return TITLES.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.genres.some((g) => g.toLowerCase().includes(needle)) ||
        t.network.toLowerCase().includes(needle)
    ).slice(0, 9);
  }, [q]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[sel]) onOpen(results[sel].id);
  };

  const statusLabel: Record<string, string> = {
    watching: "Watching", caughtup: "Caught up", watchlist: "Watchlist", upcoming: "Coming soon", finished: "Finished",
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
            placeholder="Search shows, genres, networks…"
          />
          <kbd className="mq-kbd">esc</kbd>
        </div>
        <div className="mq-pal-list no-scrollbar">
          {results.length === 0 && (
            <div className="mq-pal-empty">No matches for “{q}” — try a genre like “Sci-Fi” or a network.</div>
          )}
          {results.map((t, i) => (
            <div
              key={t.id}
              className={`mq-pal-row ${i === sel ? "on" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onOpen(t.id)}
            >
              <div className="mq-pal-art" style={{ background: posterBg(t.title) }} />
              <div className="flex-1 min-w-0">
                <div className="mq-pal-title">{t.title}</div>
                <div className="mq-pal-sub">{t.year} · {t.genres.slice(0, 2).join(" · ")} · {t.network}</div>
              </div>
              <span className="badge badge-soft">{statusLabel[t.status]}</span>
              <ArrowRight size={14} className="mute" />
            </div>
          ))}
        </div>
        <div className="mq-pal-foot">
          <span><kbd className="mq-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="mq-kbd">↵</kbd> open</span>
          <span className="mute">{TITLES.length} titles in your library</span>
        </div>
      </div>
    </>
  );
}

/* ============================================================
   TONIGHT — bento home
   ============================================================ */
function Tonight({ go }: { go: (t: Tab) => void }) {
  const { open } = useUI();
  const watching = inStatus("watching");
  const fresh = watching.filter((t) => t.next?.air.includes("New") || t.next?.air.includes("aired"));
  const hero = fresh[0] ?? watching[0];
  const rest = watching.filter((t) => t.id !== hero.id);
  const soon = inStatus("upcoming").filter((t) => t.premiere?.startsWith("2026-07") || t.premiere?.startsWith("2026-08"));
  const [heroDone, setHeroDone] = useState(false);

  const stats = [
    { icon: Eye, label: "Episodes this week", value: "12" },
    { icon: Clock, label: "Watch time", value: "9h 40m" },
    { icon: Flame, label: "Day streak", value: "23" },
    { icon: Tv, label: "Following", value: "37" },
  ];

  const heroProgress = hero.seenEps && hero.totalEps ? Math.round((hero.seenEps / hero.totalEps) * 100) : 0;
  const seeAll = (t: Tab) => (
    <button className="btn btn-ghost btn-sm" onClick={() => go(t)}>See all <ChevronRight size={14} /></button>
  );

  return (
    <div className="screen mq-page">
      <MqHeader
        title="Tonight"
        sub={`Saturday, July 4 — ${fresh.length} new episodes waiting, ${soon.length} premieres on the way.`}
      />

      {/* Bento: hero + stats */}
      <div className="mq-bento">
        <section className="card mq-hero" onClick={() => open(hero.id)}>
          <div className="mq-hero-art" style={{ background: posterBg(hero.title) }}>
            <div className="poster-sheen" />
            <NetworkLogo network={hero.network} />
          </div>
          <div className="mq-hero-body">
            <div className="eyebrow">Up next for you</div>
            <h2 className="mq-hero-ep">{hero.next?.title}</h2>
            <div className="mq-hero-show">
              {hero.title} — S{hero.next?.s} · E{hero.next?.e}
              {hero.next?.air && <span className="badge badge-accent" style={{ marginLeft: 10 }}>{hero.next.air}</span>}
            </div>
            <div className="mq-hero-track"><i style={{ width: `${heroProgress}%` }} /></div>
            <div className="mq-hero-meta mute">{hero.seenEps}/{hero.totalEps} episodes · {heroProgress}% done</div>
            <div className="mq-hero-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-accent" onClick={() => setHeroDone((v) => !v)}>
                <Check size={16} />{heroDone ? "Watched ✓" : "Mark watched"}
              </button>
              <button className="btn btn-outline" onClick={() => open(hero.id)}>Details</button>
            </div>
          </div>
        </section>

        <section className="mq-statgrid">
          {stats.map((s) => (
            <div key={s.label} className="card mq-stat">
              <div className="mq-stat-ico"><s.icon size={17} /></div>
              <div className="mq-stat-val">{s.value}</div>
              <div className="mq-stat-label mute">{s.label}</div>
            </div>
          ))}
        </section>
      </div>

      {/* Continue watching */}
      <MqSection title="Continue watching" sub="Pick up where you left off">
        <div className="rail no-scrollbar">
          {rest.map((t) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }} className="flex flex-col gap-2">
              <Poster t={t} subtitle={t.next ? `S${t.next.s} · E${t.next.e}` : undefined} />
              <div className="px-0.5">
                <div style={{ fontSize: 13.5, fontWeight: 650 }} className="truncate">{t.title}</div>
                <div className="mute" style={{ fontSize: 12 }}>{t.next?.title}</div>
              </div>
            </div>
          ))}
        </div>
      </MqSection>

      {/* Fresh + premieres, side by side on desktop */}
      <div className="mq-cols">
        <MqSection title="Fresh episodes" sub="Just aired from shows you follow" action={seeAll("shows")}>
          <div className="flex flex-col gap-3">
            {fresh.map((t) => <MqFreshRow key={t.id} t={t} />)}
          </div>
        </MqSection>

        <MqSection title="Premieres soon" sub="Dated for July & August" action={seeAll("calendar")}>
          <div className="flex flex-col gap-3">
            {soon.map((t) => <MqSoonRow key={t.id} t={t} />)}
          </div>
        </MqSection>
      </div>
    </div>
  );
}

function MqFreshRow({ t }: { t: Title }) {
  const { open } = useUI();
  const [seen, setSeen] = useState(false);
  return (
    <div className="card mq-row" onClick={() => open(t.id)}>
      <div className="mq-row-art" style={{ background: posterBg(t.title) }}><div className="poster-sheen" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge badge-accent">New</span>
          <NetworkLogo network={t.network} />
        </div>
        <div className="mq-row-title truncate">{t.title}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>S{t.next?.s} E{t.next?.e} · {t.next?.title}</div>
      </div>
      <button
        className={`check ${seen ? "on" : ""}`}
        onClick={(e) => { e.stopPropagation(); setSeen((v) => !v); }}
        title="Mark watched"
      >
        <Check size={15} strokeWidth={3} />
      </button>
    </div>
  );
}

function MqSoonRow({ t }: { t: Title }) {
  const { open } = useUI();
  const [notify, setNotify] = useState(false);
  const date = t.premiereLabel?.split("·").pop()?.trim() ?? "TBA";
  return (
    <div className="card mq-row" onClick={() => open(t.id)}>
      <div className="mq-row-art" style={{ background: posterBg(t.title) }}><div className="poster-sheen" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge badge-accent">{date}</span>
          <NetworkLogo network={t.network} />
        </div>
        <div className="mq-row-title truncate">{t.title}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>{t.premiereLabel}</div>
      </div>
      <button
        className={`check ${notify ? "on" : ""}`}
        onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
        title={notify ? "Tracking" : "Notify me"}
      >
        <Bell size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/* ============================================================
   SHOWS — the library
   ============================================================ */
const SHOW_FILTERS: { key: string; label: string; match: (t: Title) => boolean }[] = [
  { key: "watching", label: "Watching", match: (t) => t.status === "watching" },
  { key: "caughtup", label: "Caught up", match: (t) => t.status === "caughtup" },
  { key: "watchlist", label: "Watchlist", match: (t) => t.status === "watchlist" },
  { key: "upcoming", label: "Upcoming", match: (t) => t.status === "upcoming" },
  { key: "finished", label: "Finished", match: (t) => t.status === "finished" },
  { key: "all", label: "All", match: () => true },
];

function Shows() {
  const wl = useWatchlist();
  const [f, setF] = useState("watching");
  const [sort, setSort] = useState<"az" | "rating">("az");
  const filter = SHOW_FILTERS.find((x) => x.key === f)!;
  const library = wl.followed; // your watchlist
  const items = [...library.filter(filter.match)].sort((a, b) =>
    sort === "az" ? a.title.localeCompare(b.title) : b.tmdb - a.tmdb
  );

  return (
    <div className="screen mq-page">
      <MqHeader title="Shows" sub={`${library.length} shows in your watchlist.`} />

      <div className="mq-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {SHOW_FILTERS.map((x) => (
            <button
              key={x.key}
              className={`chip ${f === x.key ? "chip-active" : ""}`}
              onClick={() => setF(x.key)}
            >
              {x.label}
              <span className="mute" style={{ fontWeight: 700 }}>{library.filter(x.match).length}</span>
            </button>
          ))}
        </div>
        <div className="segmented">
          {(["az", "rating"] as const).map((s) => (
            <div key={s} className={`seg ${sort === s ? "seg-active" : ""}`} onClick={() => setSort(s)}>
              {s === "az" ? "A–Z" : "Top rated"}
            </div>
          ))}
        </div>
      </div>

      {f === "caughtup" && (
        <p className="dim" style={{ fontSize: 13.5, margin: "-8px 0 0" }}>
          Watched everything that's aired — just waiting on the next season.
        </p>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((t) => (
          <div key={t.id} className="flex flex-col gap-1.5">
            <Poster t={t} />
            {t.status === "caughtup" && t.waitingFor && (
              <div className="mute" style={{ fontSize: 11.5, paddingLeft: 2 }}>⏳ {t.waitingFor}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   EXPLORE — discover
   ============================================================ */
function Explore({ onSearch }: { onSearch: () => void }) {
  const wl = useWatchlist();
  const [genre, setGenre] = useState<string | null>(null);
  const pool = wl.discover; // shows you don't follow yet
  const filtered = genre ? pool.filter((t) => t.genres.includes(genre)) : pool;
  const trending = [...TITLES].sort((a, b) => b.tmdb - a.tmdb).slice(0, 8);

  const collections = [
    { name: "Critically acclaimed", sub: "The best-reviewed of the decade", hue: 265 },
    { name: "Bingeable in a weekend", sub: "Under 20 episodes", hue: 12 },
    { name: "Mind-benders", sub: "Sci-fi that rewires you", hue: 190 },
    { name: "Award winners", sub: "Emmy & Globe darlings", hue: 45 },
  ];

  return (
    <div className="screen mq-page">
      <MqHeader title="Explore" sub="Trending, hand-picked collections, and everything worth adding." />

      <button className="card mq-searchrow" onClick={onSearch}>
        <Search size={18} className="mute" />
        <span className="mute">Search shows, genres, networks…</span>
        <kbd className="mq-kbd" style={{ marginLeft: "auto" }}>⌘K</kbd>
      </button>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <button className={`chip ${genre === null ? "chip-active" : ""}`} onClick={() => setGenre(null)}>All genres</button>
        {GENRES.map((g) => (
          <button key={g} className={`chip ${genre === g ? "chip-active" : ""}`} onClick={() => setGenre(g)}>{g}</button>
        ))}
      </div>

      <MqSection title="Trending this week" sub="What everyone's watching">
        <div className="rail no-scrollbar">
          {trending.map((t, i) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }} className="relative">
              <div className="mq-rank">{i + 1}</div>
              <Poster t={t} showNetwork={false} />
            </div>
          ))}
        </div>
      </MqSection>

      <MqSection title="Collections" sub="Hand-picked by theme">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
          {collections.map((c) => (
            <div key={c.name} className="poster" style={{ aspectRatio: "16/9", background: `linear-gradient(140deg, hsl(${c.hue} 55% 32%), hsl(${(c.hue + 40) % 360} 60% 16%))` }}>
              <div className="poster-sheen" />
              <div className="poster-body">
                <div className="poster-title" style={{ fontSize: 17 }}>{c.name}</div>
                <div className="poster-sub">{c.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </MqSection>

      <MqSection title={genre ? `Popular in ${genre}` : "Not in your watchlist"} sub="Follow a show to add it to your library and calendar">
        {filtered.length === 0 ? (
          <p className="dim" style={{ fontSize: 14 }}>You're already following everything here. 🎉</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
            {filtered.map((t) => (
              <div key={t.id} className="flex flex-col gap-2">
                <Poster t={t} />
                <button
                  className={`btn btn-sm ${wl.isFollowed(t.id) ? "btn-accent" : "btn-outline"}`}
                  onClick={(e) => { e.stopPropagation(); wl.toggle(t.id); }}
                >
                  {wl.isFollowed(t.id) ? <><Check size={15} />Following</> : <><Plus size={15} />Follow</>}
                </button>
              </div>
            ))}
          </div>
        )}
      </MqSection>
    </div>
  );
}

/* ============================================================
   CALENDAR — my shows' upcoming episodes + premieres
   ============================================================ */
type Bucket = "month" | "later" | "tba";
function bucketOf(t: Title): Bucket {
  const p = t.premiere ?? "";
  if (p.startsWith("2026-07")) return "month";
  if (/^2026-(08|09|10|11|12)/.test(p)) return "later";
  return "tba";
}

const MS_DAY = 86400000;
const TODAY_START = (() => { const d = new Date(CAL_TODAY); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const dayOffset = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return Math.round((d.getTime() - TODAY_START) / MS_DAY); };
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtWeekday = (ts: number) => new Date(ts).toLocaleDateString("en-US", { weekday: "long" });
const fmtFullDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = (ts: number) => new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const pad2 = (n: number) => String(n).padStart(2, "0");

function CalendarTab() {
  const [view, setView] = useState<"shows" | "returning" | "new">("shows");
  const tabs: [typeof view, string][] = [
    ["shows", "My shows"], ["returning", "Returning series"], ["new", "New & announced"],
  ];

  return (
    <div className="screen mq-page">
      <MqHeader
        title="Calendar"
        sub="Every upcoming episode from the shows you follow — plus the premieres you're tracking."
      />

      <div className="segmented" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {tabs.map(([v, label]) => (
          <div key={v} className={`seg ${view === v ? "seg-active" : ""}`} onClick={() => setView(v)}>{label}</div>
        ))}
      </div>

      {view === "shows" ? <MyShowsFeed /> : <PremieresList kind={view} />}
    </div>
  );
}

/* TV-Time-style chronological feed: history above, today, then the week and
   "Later". Scrolling up lazily loads more past weeks. */
function MyShowsFeed() {
  const wl = useWatchlist();
  const [weeksBack, setWeeksBack] = useState(3);
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const topRef = useRef<HTMLDivElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const prevH = useRef(0);

  const eps = useMemo(() => episodeFeed(wl.followed, weeksBack, 12), [wl.followed, weeksBack]);
  const latestKey = useMemo(() => {
    let best: FeedEp | undefined;
    for (const e of eps) if (e.time < CAL_NOW && (!best || e.time > best.time)) best = e;
    return best?.key;
  }, [eps]);

  // group into per-day buckets (offset <= 6) plus a single "Later" bucket
  const { days, later } = useMemo(() => {
    const map = new Map<number, FeedEp[]>();
    const later: FeedEp[] = [];
    for (const ep of eps) {
      const off = dayOffset(ep.time);
      if (off >= 7) { later.push(ep); continue; }
      (map.get(off) ?? map.set(off, []).get(off)!).push(ep);
    }
    const days = [...map.entries()].sort((a, b) => a[0] - b[0]);
    return { days, later };
  }, [eps]);

  // lazy history: an observer near the top pulls in earlier weeks
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver((ents) => {
      if (ents[0].isIntersecting && weeksBack < 60) {
        prevH.current = document.documentElement.scrollHeight;
        setWeeksBack((w) => w + 3);
      }
    }, { rootMargin: "300px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [weeksBack]);

  // keep the viewport steady when earlier weeks are prepended
  useLayoutEffect(() => {
    if (prevH.current) {
      const delta = document.documentElement.scrollHeight - prevH.current;
      if (delta > 0) window.scrollBy(0, delta);
      prevH.current = 0;
    }
  }, [weeksBack]);

  // land on "Today" on first render
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      todayRef.current?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -76);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const isSeen = (ep: FeedEp) => !toggled.has(ep.key);
  const toggleSeen = (ep: FeedEp) =>
    setToggled((s) => { const n = new Set(s); n.has(ep.key) ? n.delete(ep.key) : n.add(ep.key); return n; });

  const dayLabel = (off: number, ts: number) => {
    if (off === 0) return "Today";
    if (off === 1) return "Tomorrow";
    if (off > 1) return fmtWeekday(ts);
    return fmtFullDate(ts).toUpperCase();
  };

  if (wl.followed.length === 0) {
    return <p className="dim">You're not following any shows yet.</p>;
  }

  return (
    <div className="cal-feed">
      <div ref={topRef} className="cal-sentinel">
        {weeksBack < 60 ? "Loading earlier episodes…" : "That's the start of your history."}
      </div>

      {days.map(([off, list]) => (
        <div key={off} ref={off === 0 ? todayRef : undefined} className="cal-day">
          <div className="cal-daysep"><span>{dayLabel(off, list[0].time)}</span></div>
          {list.map((ep) => (
            <CalEpRow key={ep.key} ep={ep} latestKey={latestKey} seen={isSeen(ep)} onToggle={() => toggleSeen(ep)} />
          ))}
        </div>
      ))}

      {later.length > 0 && (
        <div className="cal-day">
          <div className="cal-daysep"><span>Later</span></div>
          {later.map((ep) => (
            <CalEpRow key={ep.key} ep={ep} latestKey={latestKey} later seen={isSeen(ep)} onToggle={() => toggleSeen(ep)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CalEpRow({ ep, latestKey, later = false, seen, onToggle }: {
  ep: FeedEp; latestKey?: string; later?: boolean; seen: boolean; onToggle: () => void;
}) {
  const { open } = useUI();
  const past = ep.time < CAL_NOW;
  const days = dayOffset(ep.time);

  const badge = () => {
    if (ep.key === latestKey) return <span className="badge badge-soft">Latest</span>;
    if (ep.premiere) return <span className="badge badge-soft">Premiere</span>;
    if (past && CAL_NOW - ep.time < 3 * MS_DAY) return <span className="badge badge-accent">New</span>;
    if (past) return <span className="badge badge-aired">Aired</span>;
    return null;
  };

  return (
    <div className="cal-ep" onClick={() => open(ep.titleId)}>
      <div className="cal-ep-art" style={{ background: posterBg(ep.show) }}><div className="poster-sheen" /></div>
      <div className="cal-ep-main">
        <span className="cal-showpill">{ep.show}<ChevronRight size={12} /></span>
        <div className="cal-ep-se">
          S{pad2(ep.s)} · E{pad2(ep.e)}
          {ep.premiere && !past && <span className="badge badge-soft" style={{ marginLeft: 8 }}>Premiere</span>}
        </div>
        <div className="cal-ep-name mute">{ep.name}</div>
      </div>
      <div className="cal-ep-right">
        {later ? (
          <>
            <div className="cal-days">{days}<span>days</span></div>
            <div className="cal-when mute">{fmtShort(ep.time)} · {fmtTime(ep.time)}</div>
          </>
        ) : past ? (
          <div className="cal-past" onClick={(e) => e.stopPropagation()}>
            {badge()}
            <button className={`check ${seen ? "on" : ""}`} onClick={onToggle} title={seen ? "Watched" : "Mark watched"}>
              <Check size={15} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <>
            <div className="cal-time">{fmtTime(ep.time)}</div>
            <NetworkLogo network={ep.network} />
          </>
        )}
      </div>
    </div>
  );
}

function PremieresList({ kind }: { kind: "returning" | "new" }) {
  const wl = useWatchlist();
  const items = wl.inStatus("upcoming").filter((t) =>
    kind === "returning" ? /Season/.test(t.premiereLabel ?? "") : !/Season/.test(t.premiereLabel ?? "")
  );

  const groups: { key: Bucket; title: string; sub: string }[] = [
    { key: "month", title: "This month", sub: "July 2026" },
    { key: "later", title: "Later in 2026", sub: "Dated premieres" },
    { key: "tba", title: "Announced · no date yet", sub: "We'll tell you the moment it's dated" },
  ];

  if (items.length === 0) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        Nothing {kind === "returning" ? "returning" : "new"} from the shows you follow right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => {
        const rows = items.filter((t) => bucketOf(t) === g.key);
        if (!rows.length) return null;
        return (
          <div key={g.key} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="section-title">{g.title}</h2>
              <span className="mute" style={{ fontSize: 13 }}>{g.sub}</span>
            </div>
            <div className="flex flex-col gap-3">
              {rows.map((t) => <MqUpcomingRow key={t.id} t={t} announced={g.key === "tba"} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MqUpcomingRow({ t, announced }: { t: Title; announced: boolean }) {
  const { open } = useUI();
  const [notify, setNotify] = useState(false);
  return (
    <div className="card mq-row" onClick={() => open(t.id)}>
      <div className="mq-row-art tall" style={{ background: posterBg(t.title) }}><div className="poster-sheen" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${announced ? "badge-soft" : "badge-accent"}`}>
            {announced ? "Announced" : t.premiereLabel?.split("·").pop()?.trim()}
          </span>
          <NetworkLogo network={t.network} />
        </div>
        <div className="mq-row-title truncate" style={{ fontSize: 16 }}>{t.title}</div>
        <div className="dim truncate" style={{ fontSize: 13 }}>{t.premiereLabel} · {t.genres.slice(0, 2).join(", ")}</div>
      </div>
      <button
        className={`btn btn-sm hidden sm:inline-flex ${notify ? "btn-accent" : "btn-outline"}`}
        onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
      >
        <Bell size={15} />{notify ? "Tracking" : "Notify me"}
      </button>
      <button
        className={`sm:hidden check ${notify ? "on" : ""}`}
        onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
      >
        <Bell size={14} />
      </button>
    </div>
  );
}

/* ============================================================
   YOU — profile + all ratings
   ============================================================ */
type RateSort = "new" | "old" | "best" | "worst";
const RATE_PAGE = 21; // 7 full rows of 3

function You() {
  const [sort, setSort] = useState<RateSort>("new");
  const [page, setPage] = useState(0);

  const rated = useMemo(() => {
    const byNew = (a: Title, b: Title) => ratedAtOf(b.id) - ratedAtOf(a.id);
    return TITLES.filter((t) => (t.myScore ?? 0) > 0).sort((a, b) => {
      if (sort === "new") return byNew(a, b);
      if (sort === "old") return -byNew(a, b);
      if (sort === "best") return (b.myScore! - a.myScore!) || byNew(a, b);
      return (a.myScore! - b.myScore!) || byNew(a, b); // worst
    });
  }, [sort]);

  const pageCount = Math.max(1, Math.ceil(rated.length / RATE_PAGE));
  const clamped = Math.min(page, pageCount - 1);
  const start = clamped * RATE_PAGE;
  const shown = rated.slice(start, start + RATE_PAGE);

  const sorts: { v: RateSort; label: string }[] = [
    { v: "new", label: "Newest" }, { v: "old", label: "Oldest" },
    { v: "best", label: "Best rated" }, { v: "worst", label: "Worst rated" },
  ];

  const stats = [
    { icon: Eye, label: "Episodes watched", value: "9,196" },
    { icon: Clock, label: "Time spent", value: "77 days" },
    { icon: Tv, label: "Shows followed", value: "326" },
    { icon: CalendarClock, label: "Tracking soon", value: "7" },
    { icon: Users, label: "Friends", value: "6" },
    { icon: Star, label: "Avg. rating", value: "8.4" },
  ];

  return (
    <div className="screen mq-page">
      <div className="card overflow-hidden">
        <div className="profile-cover" />
        <div className="px-6 pb-6" style={{ marginTop: -44 }}>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex items-end gap-4">
              <div className="profile-avatar grid place-items-center">C</div>
              <div className="pb-1">
                <div style={{ fontSize: 22, fontWeight: 800 }}>Carlos Martínez</div>
                <div className="dim" style={{ fontSize: 13.5 }}>@cmdelaosa · Geneva 🇨🇭</div>
              </div>
            </div>
            <button className="btn btn-outline"><Share2 size={16} />Share profile</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {stats.map((s) => (
          <div key={s.label} className="card p-4 flex flex-col gap-1">
            <s.icon size={18} style={{ color: "var(--accent)" }} />
            <div style={{ fontSize: 22, fontWeight: 800 }} className="mt-1">{s.value}</div>
            <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <MqSection title="Your ratings" sub={`${rated.length} shows scored`}>
        <div className="mq-rate-toolbar">
          <div className="segmented" style={{ flexWrap: "wrap" }}>
            {sorts.map((s) => (
              <div
                key={s.v}
                className={`seg ${sort === s.v ? "seg-active" : ""}`}
                onClick={() => { setSort(s.v); setPage(0); }}
              >
                {s.label}
              </div>
            ))}
          </div>
          <span className="mute" style={{ fontSize: 12.5 }}>
            {start + 1}–{Math.min(start + RATE_PAGE, rated.length)} of {rated.length}
          </span>
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {shown.map((t) => <MqRatingRow key={t.id} t={t} />)}
        </div>

        {pageCount > 1 && (
          <div className="mq-pager">
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === 0}
              style={{ opacity: clamped === 0 ? 0.4 : 1, pointerEvents: clamped === 0 ? "none" : "auto" }}
              onClick={() => setPage(clamped - 1)}
            >
              <ChevronLeft size={15} />Prev
            </button>
            <span>Page {clamped + 1} of {pageCount}</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === pageCount - 1}
              style={{ opacity: clamped === pageCount - 1 ? 0.4 : 1, pointerEvents: clamped === pageCount - 1 ? "none" : "auto" }}
              onClick={() => setPage(clamped + 1)}
            >
              Next<ChevronRight size={15} />
            </button>
          </div>
        )}
      </MqSection>
    </div>
  );
}

function MqRatingRow({ t }: { t: Title }) {
  const { open } = useUI();
  return (
    <div className="card mq-row" onClick={() => open(t.id)}>
      <div className="mq-row-art" style={{ background: posterBg(t.title) }}><div className="poster-sheen" /></div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate" style={{ marginTop: 0 }}>{t.title}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>{t.year} · {t.genres[0]} · rated {ratedAtLabel(t.id)}</div>
        <div style={{ marginTop: 4 }}><Stars score={t.myScore} size={13} /></div>
      </div>
      <div className="mq-score">{t.myScore}<span>/10</span></div>
    </div>
  );
}

/* ============================================================
   Shared editorial pieces
   ============================================================ */
function MqHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="mq-header">
      <h1 className="mq-h1">{title}</h1>
      <p className="dim mq-sub">{sub}</p>
    </header>
  );
}

function MqSection({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{title}</h2>
          {sub && <p className="mute" style={{ fontSize: 13 }}>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
