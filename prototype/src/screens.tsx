import { useMemo, useState } from "react";
import {
  Search, Bell, Plus, Check, Calendar, Sparkles, Clock, ChevronRight, X,
  Flame, Star, Users, Trophy, BarChart3, Eye, Share2, Heart, CalendarClock, Tv,
} from "lucide-react";
import { Title, Status, TITLES, GENRES, byId, inStatus, fakeEpisodes } from "./data";
import { Poster, Stars, useUI, posterBg, QuickAdd, NetworkLogo } from "./components";

/* ============================= HOME ============================= */
export function Home() {
  const watching = inStatus("watching");
  const soon = inStatus("upcoming").filter((t) => t.premiere?.startsWith("2026-07") || t.premiere?.startsWith("2026-08"));
  const fresh = watching.filter((t) => t.next?.air.includes("New") || t.next?.air.includes("aired"));

  return (
    <div className="screen flex flex-col gap-9">
      <header className="flex flex-col gap-1">
        <div className="eyebrow">Saturday · July 4</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>Good evening, Carlos</h1>
        <p className="dim" style={{ fontSize: 15 }}>You have 4 shows with new episodes and 3 premieres this month.</p>
      </header>

      <StatStrip />

      <Section title="Continue watching" sub="Pick up where you left off">
        <div className="rail no-scrollbar">
          {watching.map((t) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }} className="flex flex-col gap-2">
              <Poster t={t} subtitle={t.next ? `S${t.next.s} · E${t.next.e}` : undefined} />
              <div className="px-0.5">
                <div style={{ fontSize: 13.5, fontWeight: 650 }} className="truncate">{t.title}</div>
                <div className="mute" style={{ fontSize: 12 }}>{t.next?.title}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {fresh.length > 0 && (
        <Section title="Fresh episodes" sub="Just aired from shows you follow" accentIcon>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {fresh.map((t) => (
              <FreshRow key={t.id} t={t} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Premieres this month" sub="Coming soon to your list">
        <div className="rail no-scrollbar">
          {soon.map((t) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }}>
              <Poster t={t} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StatStrip() {
  const items = [
    { icon: Eye, label: "Episodes this week", value: "12" },
    { icon: Clock, label: "Watch time", value: "9h 40m" },
    { icon: Flame, label: "Day streak", value: "23" },
    { icon: Tv, label: "Following", value: "37" },
  ];
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {items.map((s) => (
        <div key={s.label} className="card p-4 flex items-center gap-3">
          <div className="grid place-items-center" style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
            <s.icon size={19} />
          </div>
          <div className="leading-tight">
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.value}</div>
            <div className="mute" style={{ fontSize: 11.5 }}>{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FreshRow({ t }: { t: Title }) {
  const { open } = useUI();
  const [seen, setSeen] = useState(false);
  return (
    <div className="card p-3 flex items-center gap-3.5 cursor-pointer" onClick={() => open(t.id)}>
      <div className="poster" style={{ background: posterBg(t.title), width: 52, height: 78, flex: "0 0 auto", borderRadius: "var(--r-sm)" }}>
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge badge-accent">New</span>
          <NetworkLogo network={t.network} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate mt-1">{t.title}</div>
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

/* ============================= LIBRARY ============================= */
const LIB_FILTERS: { key: string; label: string; match: (t: Title) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "watching", label: "Watching", match: (t) => t.status === "watching" },
  { key: "watchlist", label: "Watchlist", match: (t) => t.status === "watchlist" },
  { key: "upcoming", label: "Upcoming", match: (t) => t.status === "upcoming" },
  { key: "finished", label: "Finished", match: (t) => t.status === "finished" },
];

export function Library() {
  const [f, setF] = useState("all");
  const filter = LIB_FILTERS.find((x) => x.key === f)!;
  const items = TITLES.filter(filter.match);

  return (
    <div className="screen flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Your library</h1>
        <p className="dim" style={{ fontSize: 14.5 }}>{TITLES.length} titles tracked</p>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {LIB_FILTERS.map((x) => (
          <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
            {x.label}
            <span className="mute" style={{ fontWeight: 700 }}>{TITLES.filter(x.match).length}</span>
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((t) => (
          <Poster key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

/* ============================= DISCOVER ============================= */
export function Discover() {
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
    <div className="screen flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Discover</h1>
        <div className="card flex items-center gap-3 px-4" style={{ height: 52, maxWidth: 560 }}>
          <Search size={19} className="mute" />
          <input
            placeholder="Search shows, movies, people…"
            className="bg-transparent outline-none flex-1"
            style={{ color: "var(--text)", fontSize: 15 }}
          />
          <kbd className="badge badge-soft">⌘K</kbd>
        </div>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <button className={`chip ${genre === null ? "chip-active" : ""}`} onClick={() => setGenre(null)}>All genres</button>
        {GENRES.map((g) => (
          <button key={g} className={`chip ${genre === g ? "chip-active" : ""}`} onClick={() => setGenre(g)}>{g}</button>
        ))}
      </div>

      <Section title="Trending this week" sub="What everyone's watching" accentIcon>
        <div className="rail no-scrollbar">
          {trending.map((t, i) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }} className="relative">
              <div style={{ position: "absolute", top: -6, left: -6, zIndex: 3, fontSize: 30, fontWeight: 900, color: "var(--accent)", textShadow: "0 2px 10px rgba(0,0,0,.5)", WebkitTextStroke: "1px rgba(0,0,0,.25)" }}>{i + 1}</div>
              <Poster t={t} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Collections" sub="Hand-picked by theme">
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
      </Section>

      <Section title={genre ? `Popular in ${genre}` : "Popular right now"} sub="Tap ＋ to add to your library">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {filtered.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 group">
              <Poster t={t} />
              <QuickAdd label={t.status === "upcoming" ? "Notify" : "Add"} icon={t.status === "upcoming" ? "bell" : "plus"} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ============================= COMING SOON ============================= */
type Bucket = "month" | "later" | "tba";
function bucketOf(t: Title): Bucket {
  const p = t.premiere ?? "";
  if (p.startsWith("2026-07")) return "month";
  if (/^2026-(08|09|10|11|12)/.test(p)) return "later";
  return "tba";
}

export function ComingSoon() {
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
    <div className="screen flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <CalendarClock size={26} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Coming soon</h1>
        </div>
        <p className="dim" style={{ fontSize: 14.5, maxWidth: 560 }}>
          Premieres, new seasons, and shows that have only been announced. Add anything here to your watchlist and get a heads-up the moment it's dated.
        </p>
        <div className="segmented mt-1" style={{ alignSelf: "flex-start" }}>
          {(["all", "returning", "new"] as const).map((v) => (
            <div key={v} className={`seg ${view === v ? "seg-active" : ""}`} onClick={() => setView(v)}>
              {v === "all" ? "Everything" : v === "returning" ? "Returning series" : "New & announced"}
            </div>
          ))}
        </div>
      </header>

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
              {rows.map((t) => <UpcomingRow key={t.id} t={t} announced={g.key === "tba"} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UpcomingRow({ t, announced }: { t: Title; announced: boolean }) {
  const { open } = useUI();
  const [notify, setNotify] = useState(false);
  return (
    <div className="card p-3.5 flex items-center gap-4 cursor-pointer" onClick={() => open(t.id)}>
      <div className="poster" style={{ background: posterBg(t.title), width: 64, height: 96, flex: "0 0 auto", borderRadius: "var(--r-sm)" }}>
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${announced ? "badge-soft" : "badge-accent"}`}>
            {announced ? "Announced" : t.premiereLabel?.split("·").pop()?.trim()}
          </span>
          <NetworkLogo network={t.network} />
        </div>
        <div style={{ fontWeight: 750, fontSize: 16 }} className="truncate mt-1">{t.title}</div>
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

/* ============================= PROFILE ============================= */
export function Profile() {
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
    <div className="screen flex flex-col gap-8">
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

      <Section title="Badges" sub="Milestones you've unlocked" accentIcon>
        <div className="flex flex-wrap gap-3">
          {badges.map((b) => (
            <div key={b} className="card px-4 py-3 flex items-center gap-2.5">
              <Trophy size={17} style={{ color: "var(--accent)" }} />
              <span style={{ fontWeight: 650, fontSize: 14 }}>{b}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Favorites" sub="Your 9+ rated titles">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {favs.map((t) => <Poster key={t.id} t={t} />)}
        </div>
      </Section>
    </div>
  );
}

/* ============================= SHARED ============================= */
function Section({ title, sub, children, accentIcon }: { title: string; sub?: string; children: React.ReactNode; accentIcon?: boolean }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {accentIcon && <Sparkles size={18} style={{ color: "var(--accent)" }} />}
          <div>
            <h2 className="section-title">{title}</h2>
            {sub && <p className="mute" style={{ fontSize: 13 }}>{sub}</p>}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

/* ============================= DETAIL SHEET ============================= */
export function DetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = byId(id);
  const [rating, setRating] = useState(t?.myScore ?? 0);
  const eps = useMemo(() => (t ? fakeEpisodes(t) : []), [t]);
  const [checks, setChecks] = useState<Record<number, boolean>>(() => {
    const o: Record<number, boolean> = {};
    eps.forEach((e) => (o[e.idx] = e.seen));
    return o;
  });
  const [season, setSeason] = useState(1);
  if (!t) return null;

  const seasons = Array.from(new Set(eps.map((e) => e.s)));
  const isTV = t.kind === "tv";
  const isUpcoming = t.status === "upcoming";

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        className="sheet-center fixed z-[70] card overflow-hidden flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(760px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
        }}
      >
        {/* Hero */}
        <div className="relative" style={{ height: 200, background: posterBg(t.title), flex: "0 0 auto" }}>
          <div className="poster-sheen" />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
          <button className="btn btn-icon badge-glass absolute" style={{ top: 14, right: 14, color: "#fff" }} onClick={onClose}>
            <X size={18} />
          </button>
          <div className="absolute flex items-end gap-4" style={{ left: 24, right: 24, bottom: 16 }}>
            <div className="poster" style={{ width: 96, height: 144, flex: "0 0 auto", background: posterBg(t.title + "x") }}>
              <div className="poster-sheen" />
            </div>
            <div className="pb-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <NetworkLogo network={t.network} size={12} />
                {isUpcoming && <span className="badge badge-accent">{t.premiereLabel}</span>}
              </div>
              <h2 style={{ fontSize: 26, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)" }}>{t.title}</h2>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.85)" }}>{t.year} · {t.genres.join(" · ")}{t.runtime ? ` · ${t.runtime}` : ""}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 flex flex-col gap-6">
          {/* Actions */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {isUpcoming ? (
              <>
                <button className="btn btn-accent"><Bell size={16} />Notify me when it airs</button>
                <button className="btn btn-outline"><Plus size={16} />Watchlist</button>
              </>
            ) : (
              <>
                <button className="btn btn-accent">
                  {t.status === "finished" ? <><Check size={16} />Watched</> : <><Eye size={16} />Mark up to here</>}
                </button>
                <button className="btn btn-outline"><Heart size={16} />Favorite</button>
              </>
            )}
            <button className="btn btn-ghost btn-icon"><Share2 size={16} /></button>
          </div>

          {/* Rating */}
          {!isUpcoming && (
            <div className="flex items-center justify-between card p-4">
              <div>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>Your rating</div>
                <div className="mute" style={{ fontSize: 12.5 }}>{rating ? `${rating}/10` : "Not rated yet"}</div>
              </div>
              <div className="flex items-center gap-1" onMouseLeave={() => setRating(t.myScore ?? 0)}>
                {[2, 4, 6, 8, 10].map((v) => (
                  <Star
                    key={v}
                    size={26}
                    className="star"
                    style={{ color: v <= rating ? "var(--accent)" : "var(--text-mute)" }}
                    fill={v <= rating ? "currentColor" : "none"}
                    strokeWidth={v <= rating ? 0 : 1.6}
                    onMouseEnter={() => setRating(v)}
                    onClick={() => setRating(v)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Synopsis */}
          <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.6 }}>{t.synopsis}</p>

          {/* Where to watch */}
          <div>
            <div className="eyebrow mb-2.5">Where to watch</div>
            <div className="flex gap-2 flex-wrap">
              {[t.network, "Netflix", "Prime Video"].slice(0, isUpcoming ? 1 : 3).map((n, i) => (
                <span key={i} className="chip">{n}</span>
              ))}
            </div>
          </div>

          {/* Episodes */}
          {isTV && !isUpcoming && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="eyebrow">Episodes</div>
                <div className="segmented">
                  {seasons.map((s) => (
                    <div key={s} className={`seg ${season === s ? "seg-active" : ""}`} onClick={() => setSeason(s)}>S{s}</div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col">
                {eps.filter((e) => e.s === season).map((e) => (
                  <div key={e.idx} className="ep-row" onClick={() => setChecks((c) => ({ ...c, [e.idx]: !c[e.idx] }))}>
                    <div className={`check ${checks[e.idx] ? "on" : ""}`}><Check size={15} strokeWidth={3} /></div>
                    <div className="mute" style={{ fontSize: 13, width: 42, flex: "0 0 auto" }}>E{e.e}</div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">{e.title}</div>
                    </div>
                    <div className="mute" style={{ fontSize: 12 }}>{e.air}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isUpcoming && (
            <div className="card p-5 flex items-center gap-4">
              <Calendar size={30} style={{ color: "var(--accent)" }} />
              <div>
                <div style={{ fontWeight: 750, fontSize: 15 }}>{t.premiereLabel}</div>
                <div className="mute" style={{ fontSize: 13 }}>
                  {t.premiere === "Announced" ? "No release date yet — we'll notify you the moment one is announced." : "We'll remind you the day it premieres."}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
