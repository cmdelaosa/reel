import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bell, CalendarClock, Check, ChevronRight, Clapperboard, Clock, Compass,
  Eye, Flame, LayoutGrid, Play, Plus, Search, Share2, Sliders, Star,
  Trophy, Tv, User, Users,
} from "lucide-react";
import { Title, TITLES, GENRES, inStatus } from "./data";
import { Poster, NetworkLogo, QuickAdd, UICtx, useUI, posterBg } from "./components";
import { DetailSheet } from "./screens";
import { NotifPanel, DesignLab } from "./overlays";
import { useTheme } from "./theme";

/* ============================================================
   MARQUEE — a second full shell for the app. Same features as
   the classic shell, different architecture: tab navigation up
   top (floating dock on mobile), a bento-grid home, editorial
   numbered sections, and a real ⌘K command palette.
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
          {tab === "tonight" && <Tonight onExplore={() => setTab("explore")} />}
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
    watching: "Watching", watchlist: "Watchlist", upcoming: "Coming soon", finished: "Finished",
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
   01 · TONIGHT — bento home
   ============================================================ */
function Tonight({ onExplore }: { onExplore: () => void }) {
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

  return (
    <div className="screen mq-page">
      <MqHeader
        index="01"
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
      <MqSection index="02" title="Continue watching" sub="Pick up where you left off">
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
        <MqSection index="03" title="Fresh episodes" sub="Just aired from shows you follow">
          <div className="flex flex-col gap-3">
            {fresh.map((t) => <MqFreshRow key={t.id} t={t} />)}
          </div>
        </MqSection>

        <MqSection index="04" title="Premieres soon" sub="Dated for July & August">
          <div className="flex flex-col gap-3">
            {soon.map((t) => <MqSoonRow key={t.id} t={t} />)}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={onExplore}>
            Browse everything coming <ChevronRight size={14} />
          </button>
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
      <div className="mq-date">
        <span className="mq-date-d">{date}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate">{t.title}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>{t.premiereLabel} · {t.network}</div>
      </div>
      <button
        className={`btn btn-sm ${notify ? "btn-accent" : "btn-outline"}`}
        onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
      >
        <Bell size={14} />{notify ? "Tracking" : "Notify"}
      </button>
    </div>
  );
}

/* ============================================================
   02 · SHOWS — the library
   ============================================================ */
const SHOW_FILTERS: { key: string; label: string; match: (t: Title) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "watching", label: "Watching", match: (t) => t.status === "watching" },
  { key: "watchlist", label: "Watchlist", match: (t) => t.status === "watchlist" },
  { key: "upcoming", label: "Upcoming", match: (t) => t.status === "upcoming" },
  { key: "finished", label: "Finished", match: (t) => t.status === "finished" },
];

function Shows() {
  const [f, setF] = useState("all");
  const [sort, setSort] = useState<"az" | "rating">("az");
  const filter = SHOW_FILTERS.find((x) => x.key === f)!;
  const items = [...TITLES.filter(filter.match)].sort((a, b) =>
    sort === "az" ? a.title.localeCompare(b.title) : b.tmdb - a.tmdb
  );

  return (
    <div className="screen mq-page">
      <MqHeader index="02" title="Shows" sub={`${TITLES.length} titles tracked across every status.`} />

      <div className="mq-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {SHOW_FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
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

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((t) => <Poster key={t.id} t={t} />)}
      </div>
    </div>
  );
}

/* ============================================================
   03 · EXPLORE — discover
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
      <MqHeader index="03" title="Explore" sub="Trending, hand-picked collections, and everything worth adding." />

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

      <MqSection index="04" title="Trending this week" sub="What everyone's watching">
        <div className="rail no-scrollbar">
          {trending.map((t, i) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }} className="relative">
              <div className="mq-rank">{i + 1}</div>
              <Poster t={t} />
            </div>
          ))}
        </div>
      </MqSection>

      <MqSection index="05" title="Collections" sub="Hand-picked by theme">
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

      <MqSection index="06" title={genre ? `Popular in ${genre}` : "Popular right now"} sub="Tap ＋ to add to your library">
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
   04 · CALENDAR — coming soon
   ============================================================ */
type Bucket = "month" | "later" | "tba";
function bucketOf(t: Title): Bucket {
  const p = t.premiere ?? "";
  if (p.startsWith("2026-07")) return "month";
  if (/^2026-(08|09|10|11|12)/.test(p)) return "later";
  return "tba";
}

function CalendarTab() {
  const [view, setView] = useState<"all" | "returning" | "new">("all");
  const all = inStatus("upcoming");
  const items = all.filter((t) => {
    if (view === "returning") return /Season/.test(t.premiereLabel ?? "");
    if (view === "new") return !/Season/.test(t.premiereLabel ?? "");
    return true;
  });

  const groups: { key: Bucket; title: string; sub: string }[] = [
    { key: "month", title: "This month", sub: "July 2026" },
    { key: "later", title: "Later in 2026", sub: "Dated premieres" },
    { key: "tba", title: "Announced · no date yet", sub: "Track it now, we'll tell you when it's set" },
  ];

  return (
    <div className="screen mq-page">
      <MqHeader
        index="04"
        title="Calendar"
        sub="Premieres, new seasons, and announced shows. Track anything to get a heads-up the moment it's dated."
      />

      <div className="segmented" style={{ alignSelf: "flex-start" }}>
        {(["all", "returning", "new"] as const).map((v) => (
          <div key={v} className={`seg ${view === v ? "seg-active" : ""}`} onClick={() => setView(v)}>
            {v === "all" ? "Everything" : v === "returning" ? "Returning series" : "New & announced"}
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
   05 · YOU — profile
   ============================================================ */
function You() {
  const favs = TITLES.filter((t) => (t.myScore ?? 0) >= 9).slice(0, 6);
  const badges = ["Marathoner", "Night Owl", "Completionist", "Early Bird", "Critic", "Explorer"];
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

      <MqSection index="06" title="Badges" sub="Milestones you've unlocked">
        <div className="flex flex-wrap gap-3">
          {badges.map((b) => (
            <div key={b} className="card px-4 py-3 flex items-center gap-2.5">
              <Trophy size={17} style={{ color: "var(--accent)" }} />
              <span style={{ fontWeight: 650, fontSize: 14 }}>{b}</span>
            </div>
          ))}
        </div>
      </MqSection>

      <MqSection index="07" title="Favorites" sub="Your 9+ rated titles">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {favs.map((t) => <Poster key={t.id} t={t} />)}
        </div>
      </MqSection>
    </div>
  );
}

/* ============================================================
   Shared editorial pieces
   ============================================================ */
function MqHeader({ index, title, sub }: { index: string; title: string; sub: string }) {
  return (
    <header className="mq-header">
      <div className="mq-index">{index}</div>
      <div>
        <h1 className="mq-h1">{title}</h1>
        <p className="dim mq-sub">{sub}</p>
      </div>
    </header>
  );
}

function MqSection({ index, title, sub, children }: { index: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <span className="mq-index sm">{index}</span>
        <div>
          <h2 className="section-title">{title}</h2>
          {sub && <p className="mute" style={{ fontSize: 13 }}>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
