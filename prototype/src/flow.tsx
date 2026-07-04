import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark, CalendarClock, Check, Compass, LayoutGrid, Play, Search, Sparkles, Star, X,
} from "lucide-react";
import { Title, byId, inStatus, fakeEpisodes, hueOf } from "./data";
import { NetworkLogo, Poster, UICtx, posterBg } from "./components";
import { useTheme } from "./theme";

/* ============================================================
   FLOW — experimental concept: the whole app is one continuous
   cinematic scroll. The ambient light of the page follows the
   show you focus; a floating dock glides between sections.
   ============================================================ */

const SECTIONS = [
  { key: "next", label: "Up next", icon: Sparkles },
  { key: "watchlist", label: "Watchlist", icon: Bookmark },
  { key: "discover", label: "Discover", icon: Compass },
  { key: "soon", label: "Premieres", icon: CalendarClock },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

export default function Flow() {
  const { set } = useTheme();
  const watching = useMemo(() => inStatus("watching"), []);
  const [focus, setFocus] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<SectionKey>("next");
  const railRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});

  const hue = hueOf(watching[focus]?.title ?? "Flow");
  const ambRef = useRef(hue);

  /* Sweep the ambient hue with rAF (shortest path around the color wheel).
     Done in JS because a CSS transition on the registered --amb property
     breaks Chromium's compositing of the scroller subtree. */
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const from = ambRef.current;
    const delta = ((hue - from + 540) % 360) - 180;
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      ambRef.current = (((from + delta * ease(p)) % 360) + 360) % 360;
      el.style.setProperty("--amb", String(ambRef.current));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    /* rAF is frozen in throttled/background tabs — make sure the final hue lands */
    const tid = setTimeout(() => {
      ambRef.current = ((hue % 360) + 360) % 360;
      el.style.setProperty("--amb", String(ambRef.current));
    }, dur + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(tid);
    };
  }, [hue]);
  const fresh = watching.filter((t) => (t.next?.air ?? "").toLowerCase().includes("new")).length;

  /* focused card follows free carousel scrolling (trackpad / touch) */
  const onRail = () => {
    const el = railRef.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bd = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const ch = c as HTMLElement;
      const d = Math.abs(ch.offsetLeft + ch.offsetWidth / 2 - mid);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setFocus(best);
  };

  /* explicit interactions (dots, side cards, arrow keys) set focus directly —
     no dependency on scroll events landing */
  const scrollToCard = (i: number) => {
    setFocus(i);
    const c = railRef.current?.children[i] as HTMLElement | undefined;
    c?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  /* keyboard: arrows drive the hero deck, Esc closes the takeover */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setDetail(null);
      if (detail || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") scrollToCard(Math.min(focus + 1, watching.length - 1));
      if (e.key === "ArrowLeft") scrollToCard(Math.max(focus - 1, 0));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [focus, detail, watching.length]);

  /* dock highlights the section in view */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((x) => x.isIntersecting);
        if (vis.length) setActive(vis[0].target.getAttribute("data-sec") as SectionKey);
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );
    Object.values(secRefs.current).forEach((s) => s && io.observe(s));
    return () => io.disconnect();
  }, []);

  const goto = (k: SectionKey) => secRefs.current[k]?.scrollIntoView({ behavior: "smooth", block: "start" });
  const secRef = (k: SectionKey) => (el: HTMLElement | null) => (secRefs.current[k] = el);

  return (
    <UICtx.Provider value={{ open: setDetail }}>
      <div className="flow" ref={flowRef} style={{ ["--amb" as string]: ambRef.current }}>
        <div className="flow-ambient" />

        <header className="flow-head">
          <div className="flow-mark">
            <span className="flow-mark-ico"><Play size={13} fill="currentColor" strokeWidth={0} /></span>
            Reel <em>Flow</em>
          </div>
          <label className="flow-search">
            <Search size={15} />
            <input placeholder="Search shows…" />
          </label>
        </header>

        {/* ---- Up next: hero deck ---- */}
        <section className="flow-sec" data-sec="next" ref={secRef("next")}>
          <h1 className="flow-h1">
            Saturday evening.
            <span>{fresh} of your shows aired new episodes.</span>
          </h1>
          <div className="flow-rail no-scrollbar" ref={railRef} onScroll={onRail}>
            {watching.map((t, i) => (
              <EpCard
                key={t.id}
                t={t}
                focused={i === focus}
                done={!!done[t.id]}
                onFocus={() => scrollToCard(i)}
                onOpen={() => setDetail(t.id)}
                onDone={() => setDone((d) => ({ ...d, [t.id]: !d[t.id] }))}
              />
            ))}
          </div>
          <div className="flow-dots">
            {watching.map((_, i) => (
              <i key={i} className={i === focus ? "on" : ""} onClick={() => scrollToCard(i)} />
            ))}
          </div>
        </section>

        {/* ---- Watchlist shelf ---- */}
        <section className="flow-sec" data-sec="watchlist" ref={secRef("watchlist")}>
          <header className="flow-sechead">
            <h2>Watchlist</h2>
            <p>Saved for a free evening</p>
          </header>
          <div className="flow-shelf no-scrollbar">
            {inStatus("watchlist").map((t) => (
              <div key={t.id} style={{ width: "var(--rail-pw)", flex: "0 0 auto" }}>
                <Poster t={t} />
              </div>
            ))}
          </div>
        </section>

        {/* ---- Discover shelf ---- */}
        <section className="flow-sec" data-sec="discover" ref={secRef("discover")}>
          <header className="flow-sechead">
            <h2>Worth a rewatch</h2>
            <p>Finished shows you rated highly</p>
          </header>
          <div className="flow-shelf no-scrollbar">
            {inStatus("finished").map((t) => (
              <div key={t.id} style={{ width: "var(--rail-pw)", flex: "0 0 auto" }}>
                <Poster t={t} />
              </div>
            ))}
          </div>
        </section>

        {/* ---- Premieres timeline ---- */}
        <section className="flow-sec" data-sec="soon" ref={secRef("soon")}>
          <header className="flow-sechead">
            <h2>Premieres</h2>
            <p>What's landing next on your calendar</p>
          </header>
          <div className="flow-line no-scrollbar">
            {inStatus("upcoming").map((t) => (
              <div key={t.id} className="flow-stop" onClick={() => setDetail(t.id)}>
                <div className="flow-date">{t.premiereLabel ?? t.premiere ?? "TBA"}</div>
                <div className="flow-stopdot" />
                <div className="flow-stopcard">
                  <div className="flow-stopart" style={{ background: posterBg(t.title) }} />
                  <div className="min-w-0">
                    <div className="flow-stopname">{t.title}</div>
                    <div className="flow-stopmeta">{t.network} · {t.genres[0]}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="flow-foot">
          <div className="flow-stats">
            <span className="flow-stat">9,196 episodes</span>
            <span className="flow-stat">77 days watched</span>
            <span className="flow-stat">326 shows</span>
            <span className="flow-stat"><Star size={12} fill="currentColor" strokeWidth={0} /> 8.4 avg</span>
          </div>
          <button className="flow-ghost" onClick={() => set("concept", "app")}>
            <LayoutGrid size={15} /> Back to the classic app
          </button>
        </footer>

        {/* ---- Floating dock ---- */}
        <nav className="flow-dock">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`flow-dockbtn ${active === s.key ? "on" : ""}`}
              onClick={() => goto(s.key)}
              title={s.label}
            >
              <s.icon size={19} />
              <span className="flow-docklabel">{s.label}</span>
            </button>
          ))}
          <span className="flow-dockdiv" />
          <button className="flow-dockbtn" title="Back to the classic app" onClick={() => set("concept", "app")}>
            <LayoutGrid size={19} />
          </button>
        </nav>

        {detail && <Takeover id={detail} onClose={() => setDetail(null)} />}
      </div>
    </UICtx.Provider>
  );
}

/* ---- Hero episode card ---- */
function EpCard({
  t, focused, done, onFocus, onOpen, onDone,
}: {
  t: Title; focused: boolean; done: boolean;
  onFocus: () => void; onOpen: () => void; onDone: () => void;
}) {
  const p = t.seenEps && t.totalEps ? Math.round((t.seenEps / t.totalEps) * 100) : 0;
  return (
    <article className={`flow-epcard ${focused ? "is-focus" : ""}`} onClick={focused ? onOpen : onFocus}>
      <div className="flow-epart" style={{ background: posterBg(t.title) }}>
        <div className="poster-sheen" />
        <NetworkLogo network={t.network} />
      </div>
      <div className="flow-epbody">
        <div className="flow-eyebrow">
          S{t.next?.s} · E{t.next?.e} <span className="flow-sep">—</span> {t.next?.air}
        </div>
        <h3>{t.next?.title}</h3>
        <div className="flow-show">{t.title}</div>
        <div className="flow-track"><i style={{ width: `${p}%` }} /></div>
        <div className="flow-epacts" onClick={(e) => e.stopPropagation()}>
          <button className={`flow-cta ${done ? "is-done" : ""}`} onClick={onDone}>
            <Check size={15} /> {done ? "Watched" : "Mark watched"}
          </button>
          <button className="flow-ghost" onClick={onOpen}>Details</button>
        </div>
      </div>
    </article>
  );
}

/* ---- Full-screen show takeover ---- */
function Takeover({ id, onClose }: { id: string; onClose: () => void }) {
  const t = byId(id);
  const eps = useMemo(() => (t ? fakeEpisodes(t) : []), [t]);
  const [rating, setRating] = useState(t?.myScore ?? 0);
  const [season, setSeason] = useState(1);
  const [checks, setChecks] = useState<Record<number, boolean>>(() => {
    const o: Record<number, boolean> = {};
    eps.forEach((e) => (o[e.idx] = e.seen));
    return o;
  });
  if (!t) return null;

  const seasons = Array.from(new Set(eps.map((e) => e.s)));
  const filled = Math.round(rating / 2);

  /* Portaled to <body>: a fixed overlay inside the .flow scroller gets its
     background composited under the scrolled content (Chromium quirk) */
  return createPortal(
    <div className="flow-take" style={{ ["--amb" as string]: hueOf(t.title) }}>
      <div className="flow-take-bg" onClick={onClose} />
      <button className="flow-x" onClick={onClose}><X size={18} /></button>
      <div className="flow-take-scroll no-scrollbar">
        <div className="flow-take-hero">
          <div className="flow-take-art" style={{ background: posterBg(t.title) }}>
            <div className="poster-sheen" />
          </div>
          <div className="flow-take-info">
            <div className="flow-eyebrow">{t.network} · {t.year} · {t.genres.join(" · ")}</div>
            <h2>{t.title}</h2>
            <p>{t.synopsis}</p>
            <div className="flow-take-meta">
              <span className="flow-stat">
                <Star size={12} fill="currentColor" strokeWidth={0} /> {t.tmdb.toFixed(1)} TMDB
              </span>
              {t.status === "watching" && (
                <span className="flow-stat">{t.seenEps}/{t.totalEps} episodes</span>
              )}
              <span className="flow-stat flow-rate">
                Your rating
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    size={15}
                    className={`star ${i <= filled ? "on" : ""}`}
                    fill={i <= filled ? "currentColor" : "none"}
                    strokeWidth={i <= filled ? 0 : 1.6}
                    onClick={() => setRating(i * 2)}
                  />
                ))}
              </span>
            </div>
          </div>
        </div>

        {t.kind === "tv" && (
          <div className="flow-take-eps">
            <div className="segmented" style={{ alignSelf: "flex-start" }}>
              {seasons.map((s) => (
                <div key={s} className={`seg ${s === season ? "seg-active" : ""}`} onClick={() => setSeason(s)}>
                  S{s}
                </div>
              ))}
            </div>
            {eps.filter((e) => e.s === season).map((e) => (
              <div key={e.idx} className="ep-row" onClick={() => setChecks((c) => ({ ...c, [e.idx]: !c[e.idx] }))}>
                <span className={`check ${checks[e.idx] ? "on" : ""}`}><Check size={14} /></span>
                <span className="mute" style={{ width: 30, fontSize: 13 }}>E{e.e}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{e.title}</span>
                <span className="mute" style={{ fontSize: 12 }}>{e.air}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
