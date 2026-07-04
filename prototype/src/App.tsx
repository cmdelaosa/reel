import { useState } from "react";
import {
  Home as HomeIcon, LayoutGrid, Compass, CalendarClock, User,
  Bell, Search, Sliders, RotateCcw, X, Check, Tv, Sparkles, Trophy, Users,
} from "lucide-react";
import { UICtx, Logo } from "./components";
import { Home, Library, Discover, ComingSoon, Profile, DetailSheet } from "./screens";
import { useTheme, ConceptName, LookName, ThemeName, AccentName, RadiusName, DensityName } from "./theme";
import Flow from "./flow";

type Route = "home" | "library" | "discover" | "soon" | "profile";

const NAV: { key: Route; label: string; icon: any }[] = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "library", label: "Library", icon: LayoutGrid },
  { key: "discover", label: "Discover", icon: Compass },
  { key: "soon", label: "Coming soon", icon: CalendarClock },
  { key: "profile", label: "Profile", icon: User },
];

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [detail, setDetail] = useState<string | null>(null);
  const [lab, setLab] = useState(false);
  const [notif, setNotif] = useState(false);
  const { settings } = useTheme();

  if (settings.concept === "flow") return <Flow />;

  return (
    <UICtx.Provider value={{ open: setDetail }}>
      <div className="min-h-screen flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex flex-col gap-2 shrink-0 sticky top-0 h-screen px-4 py-6"
          style={{ width: 250, borderRight: "1px solid var(--border)" }}>
          <div className="px-2 mb-4"><Logo /></div>
          {NAV.map((n) => (
            <div key={n.key} className={`nav-item ${route === n.key ? "active" : ""}`} onClick={() => setRoute(n.key)}>
              <n.icon size={20} />{n.label}
            </div>
          ))}
          <div className="mt-auto flex flex-col gap-2">
            <div className="nav-item" onClick={() => setLab(true)}><Sliders size={20} />Settings</div>
            <div className="card p-3 flex items-center gap-2.5">
              <div className="grid place-items-center" style={{ width: 34, height: 34, borderRadius: "var(--r-sm)", background: "var(--surface-3)", fontWeight: 800, color: "var(--accent)" }}>C</div>
              <div className="leading-tight min-w-0">
                <div style={{ fontSize: 13, fontWeight: 700 }} className="truncate">Carlos M.</div>
                <div className="mute truncate" style={{ fontSize: 11 }}>Free plan</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-40 flex items-center gap-3 px-5 lg:px-8 py-3.5"
            style={{ background: "color-mix(in srgb, var(--bg) 80%, transparent)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}>
            <div className="lg:hidden"><Logo compact /></div>
            <div className="hidden lg:flex items-center gap-2.5 card px-3.5" style={{ height: 42, width: 320 }}>
              <Search size={17} className="mute" />
              <input placeholder="Search…" className="bg-transparent outline-none flex-1" style={{ color: "var(--text)", fontSize: 14 }} />
            </div>
            <div className="flex-1" />
            <button className="btn btn-ghost btn-icon lg:hidden"><Search size={19} /></button>
            <button className="btn btn-ghost btn-icon relative" onClick={() => setNotif((v) => !v)}>
              <Bell size={19} />
              <span style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: 999, background: "var(--accent)", border: "2px solid var(--surface)" }} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => setLab(true)} title="Settings"><Sliders size={19} /></button>
          </header>

          <main className="flex-1 px-5 lg:px-10 py-7 pb-28 lg:pb-14 w-full mx-auto" style={{ maxWidth: 1180 }}>
            {route === "home" && <Home />}
            {route === "library" && <Library />}
            {route === "discover" && <Discover />}
            {route === "soon" && <ComingSoon />}
            {route === "profile" && <Profile />}
          </main>
        </div>

        {/* Bottom nav (mobile) */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around px-2 py-2"
          style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(16px)", borderTop: "1px solid var(--border)", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
          {NAV.map((n) => (
            <button key={n.key} onClick={() => setRoute(n.key)}
              className="flex flex-col items-center gap-1 px-3 py-1"
              style={{ color: route === n.key ? "var(--accent)" : "var(--text-mute)", fontSize: 10.5, fontWeight: 600 }}>
              <n.icon size={22} />{n.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Notifications */}
      {notif && <NotifPanel onClose={() => setNotif(false)} />}

      {/* Detail sheet */}
      {detail && <DetailSheet id={detail} onClose={() => setDetail(null)} />}

      {/* Design lab */}
      {lab && <DesignLab onClose={() => setLab(false)} />}
    </UICtx.Provider>
  );
}

/* ---- Notification center (the "bell") ---- */
function NotifPanel({ onClose }: { onClose: () => void }) {
  const items = [
    { icon: Tv, accent: true, title: "New episode", body: "Severance S2 · E6 “Attila” just aired", time: "2h" },
    { icon: CalendarClock, accent: true, title: "Premiere dated", body: "Wednesday S2 now has a date — Aug 6", time: "1d" },
    { icon: Users, accent: false, title: "Friend activity", body: "Ana finished Shōgun and rated it 9", time: "2d" },
    { icon: Trophy, accent: false, title: "Badge unlocked", body: "You earned the Marathoner badge", time: "3d" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div className="fixed z-[56] card overflow-hidden sheet"
        style={{ top: 64, right: 16, width: "min(380px, 92vw)", borderRadius: "var(--r-lg)" }}>
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 750, fontSize: 15 }}>Notifications</div>
          <button className="chip" onClick={onClose}><Check size={13} />Mark all read</button>
        </div>
        <div className="flex flex-col">
          {items.map((n, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5 cursor-pointer" style={{ borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div className="grid place-items-center shrink-0" style={{ width: 36, height: 36, borderRadius: "var(--r-sm)", background: n.accent ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-3)", color: n.accent ? "var(--accent)" : "var(--text-dim)" }}>
                <n.icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{n.title}</span>
                  <span className="mute" style={{ fontSize: 11 }}>{n.time}</span>
                </div>
                <div className="dim" style={{ fontSize: 13 }}>{n.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 text-center" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="mute" style={{ fontSize: 12 }}>Delivered here + by email · configurable per type</span>
        </div>
      </div>
    </>
  );
}

/* ---- Design Lab ---- */
function DesignLab({ onClose }: { onClose: () => void }) {
  const { settings, set, reset } = useTheme();

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-2.5">
      <div className="eyebrow">{label}</div>
      {children}
    </div>
  );

  const Seg = <T extends string>({ value, options, onPick }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void }) => (
    <div className="segmented" style={{ flexWrap: "wrap" }}>
      {options.map((o) => (
        <div key={o.v} className={`seg ${value === o.v ? "seg-active" : ""}`} onClick={() => onPick(o.v)}>{o.label}</div>
      ))}
    </div>
  );

  const accents: { v: AccentName; c: string }[] = [
    { v: "coral", c: "#ff6a5c" }, { v: "violet", c: "#8b7cff" },
    { v: "emerald", c: "#35d39a" }, { v: "amber", c: "#fbbf3c" },
  ];

  const looks: { v: LookName; label: string; desc: string }[] = [
    { v: "classic", label: "Classic", desc: "The original look — clean elevated surfaces." },
    { v: "glass", label: "Aurora Glass", desc: "Frosted panels floating over ambient accent light." },
    { v: "fable", label: "Fable", desc: "Cinematic editorial — serif titles, warm ink, film grain." },
    { v: "neo", label: "Neo", desc: "Flat, bold and playful — thick borders, hard shadows." },
  ];

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet fixed z-[70] card flex flex-col"
        style={{ right: 0, top: 0, height: "100vh", width: "min(380px, 92vw)", borderRadius: 0, borderLeft: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 800, fontSize: 16 }}>Settings</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="dim" style={{ fontSize: 13, lineHeight: 1.55 }}>
            Try combinations, then just tell me which you picked. Your choice is saved locally.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-7">
          <Row label="Concept">
            <Seg<ConceptName> value={settings.concept} onPick={(v) => set("concept", v)}
              options={[{ v: "app", label: "Classic app" }, { v: "flow", label: "Flow" }]} />
            <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
              Flow (experimental): the whole app as one cinematic scroll — the ambient light follows
              the show in focus. Exit anytime from the dock.
            </p>
          </Row>

          <Row label="Look">
            <Seg<LookName> value={settings.look} onPick={(v) => set("look", v)}
              options={looks.map((l) => ({ v: l.v, label: l.label }))} />
            <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
              {looks.find((l) => l.v === settings.look)?.desc}
            </p>
          </Row>

          <Row label="Theme">
            <Seg<ThemeName> value={settings.theme} onPick={(v) => set("theme", v)}
              options={[{ v: "dark", label: "Dark" }, { v: "oled", label: "OLED black" }, { v: "light", label: "Light" }]} />
          </Row>

          <Row label="Accent color">
            <div className="flex gap-3">
              {accents.map((a) => (
                <button key={a.v} onClick={() => set("accent", a.v)}
                  className="grid place-items-center"
                  style={{
                    width: 46, height: 46, borderRadius: "var(--r)", background: a.c, cursor: "pointer",
                    border: settings.accent === a.v ? "3px solid var(--text)" : "3px solid transparent",
                    boxShadow: "0 6px 16px -8px rgba(0,0,0,.5)",
                  }}>
                  {settings.accent === a.v && <Check size={20} color="#fff" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Corner radius">
            <Seg<RadiusName> value={settings.radius} onPick={(v) => set("radius", v)}
              options={[{ v: "sharp", label: "Sharp" }, { v: "rounded", label: "Rounded" }, { v: "soft", label: "Soft" }]} />
          </Row>

          <Row label="Density">
            <Seg<DensityName> value={settings.density} onPick={(v) => set("density", v)}
              options={[{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }]} />
          </Row>

          <div className="card p-4 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Live preview</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btn-accent btn-sm">Primary</button>
              <button className="btn btn-outline btn-sm">Outline</button>
              <span className="chip chip-active">Active chip</span>
              <span className="badge badge-accent">Badge</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-ghost flex-1" onClick={reset}><RotateCcw size={15} />Reset</button>
          <button className="btn btn-accent flex-1" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}
