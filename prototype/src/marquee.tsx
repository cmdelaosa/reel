import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bell, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard,
  Clock, Compass, Eye, Flame, LayoutGrid, Play, Plus, Search, Share2, Sliders, Star,
  Tv, User, Users,
} from "lucide-react";
import { Title, TITLES, GENRES, inStatus, scheduledEpisodes, ratedAtOf, ratedAtLabel } from "./data";
import { Poster, Stars, NetworkLogo, QuickAdd, UICtx, useUI, posterBg } from "./components";
import { DetailSheet } from "./screens";
import { NotifPanel, DesignLab } from "./overlays";

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
  const [f, setF] = useState("watching");
  const [sort, setSort] = useState<"az" | "rating">("az");
  const filter = SHOW_FILTERS.find((x) => x.key === f)!;
  const items = [...TITLES.filter(filter.match)].sort((a, b) =>
    sort === "az" ? a.title.localeCompare(b.title) : b.tmdb - a.tmdb
  );

  return (
    <div className="screen mq-page">
      <MqHeader title="Shows" sub={`${TITLES.length} titles tracked across every status.`} />

      <div className="mq-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {SHOW_FILTERS.map((x) => (
            <button
              key={x.key}
              className={`chip ${f === x.key ? "chip-active" : ""}`}
              onClick={() => setF(x.key)}
            >
              {x.label}
              <span className="mute" style={{ fontWeight: 700 }}>{TITLES.filter(x.match).length}</span>
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
  const [genre, setGenre] = useState<string | null>(null);
  const pool = TITLES.filter((t) => t.status !== "watching");
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

      <MqSection title={genre ? `Popular in ${genre}` : "Popular right now"} sub="Tap ＋ to add to your library">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {filtered.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <Poster t={t} />
              <QuickAdd label={t.status === "upcoming" ? "Notify" : "Add"} icon={t.status === "upcoming" ? "bell" : "plus"} />
            </div>
          ))}
        </div>
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

function CalendarTab() {
  const [view, setView] = useState<"shows" | "premieres">("shows");

  return (
    <div className="screen mq-page">
      <MqHeader
        title="Calendar"
        sub="Upcoming episodes of the shows you follow, plus premieres you can track."
      />

      <div className="segmented" style={{ alignSelf: "flex-start" }}>
        <div className={`seg ${view === "shows" ? "seg-active" : ""}`} onClick={() => setView("shows")}>My shows</div>
        <div className={`seg ${view === "premieres" ? "seg-active" : ""}`} onClick={() => setView("premieres")}>Premieres</div>
      </div>

      {view === "shows" ? <MyShowsCalendar /> : <PremieresCalendar />}
    </div>
  );
}

function MyShowsCalendar() {
  const followed = useMemo(() => [...inStatus("watching"), ...inStatus("caughtup")], []);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = followed.every((t) => open[t.id]);

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const setAll = (v: boolean) => setOpen(Object.fromEntries(followed.map((t) => [t.id, v])));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="mute" style={{ fontSize: 13 }}>{followed.length} shows you're following</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setAll(!allOpen)}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {followed.map((t) => (
        <MyShowRow key={t.id} t={t} open={!!open[t.id]} onToggle={() => toggle(t.id)} />
      ))}
    </div>
  );
}

function MyShowRow({ t, open, onToggle }: { t: Title; open: boolean; onToggle: () => void }) {
  const eps = useMemo(() => scheduledEpisodes(t), [t]);
  const summary = eps.length
    ? `${eps.length} upcoming · next ${eps[0].date}`
    : t.waitingFor
      ? `Caught up · ${t.waitingFor}`
      : "No episodes scheduled";

  return (
    <div className="card mq-show">
      <button className="mq-show-head" onClick={onToggle}>
        <div className="mq-show-art" style={{ background: posterBg(t.title) }}><div className="poster-sheen" /></div>
        <div className="flex-1 min-w-0" style={{ textAlign: "left" }}>
          <div className="flex items-center gap-2">
            <span className="mq-row-title truncate" style={{ marginTop: 0 }}>{t.title}</span>
            <NetworkLogo network={t.network} />
          </div>
          <div className="dim truncate" style={{ fontSize: 12.5, marginTop: 2 }}>{summary}</div>
        </div>
        {eps.length > 0 && <span className="mq-show-count">{eps.length}</span>}
        <ChevronDown size={18} className="mute" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease", flex: "0 0 auto" }} />
      </button>

      {open && (
        <div className="mq-eps">
          {eps.length === 0 && (
            <div className="mq-ep" style={{ cursor: "default" }}>
              <div className="mq-ep-date mute">—</div>
              <div className="flex-1" style={{ fontSize: 13.5 }}>
                {t.waitingFor ? `New season not dated yet — ${t.waitingFor}` : "Nothing scheduled right now."}
              </div>
            </div>
          )}
          {eps.map((e) => (
            <div key={`${e.s}-${e.e}`} className="mq-ep">
              <div className={`mq-ep-date ${e.soon ? "soon" : ""}`}>{e.date}</div>
              <div className="mute" style={{ width: 46, flex: "0 0 auto", fontSize: 12.5 }}>S{e.s}·E{e.e}</div>
              <div className="flex-1 min-w-0 truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</div>
              {e.soon && <span className="badge badge-accent">Soon</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PremieresCalendar() {
  const [v, setV] = useState<"all" | "returning" | "new">("all");
  const items = inStatus("upcoming").filter((t) => {
    if (v === "returning") return /Season/.test(t.premiereLabel ?? "");
    if (v === "new") return !/Season/.test(t.premiereLabel ?? "");
    return true;
  });

  const groups: { key: Bucket; title: string; sub: string }[] = [
    { key: "month", title: "This month", sub: "July 2026" },
    { key: "later", title: "Later in 2026", sub: "Dated premieres" },
    { key: "tba", title: "Announced · no date yet", sub: "Track it now, we'll tell you when it's set" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="segmented" style={{ alignSelf: "flex-start" }}>
        {(["all", "returning", "new"] as const).map((x) => (
          <div key={x} className={`seg ${v === x ? "seg-active" : ""}`} onClick={() => setV(x)}>
            {x === "all" ? "Everything" : x === "returning" ? "Returning series" : "New & announced"}
          </div>
        ))}
      </div>

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
      <div className="hidden sm:flex items-center gap-2">
        <button
          className={`btn btn-sm ${notify ? "btn-accent" : "btn-outline"}`}
          onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
        >
          <Bell size={15} />{notify ? "Tracking" : "Notify me"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
          <Plus size={15} />Watchlist
        </button>
      </div>
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
