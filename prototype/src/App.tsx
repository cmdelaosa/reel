import { useState } from "react";
import {
  Home as HomeIcon, LayoutGrid, Compass, CalendarClock, User,
  Bell, Search, Sliders,
} from "lucide-react";
import { UICtx, Logo } from "./components";
import { Home, Library, Discover, ComingSoon, Profile, DetailSheet } from "./screens";
import { NotifPanel, DesignLab } from "./overlays";
import { useTheme } from "./theme";
import Marquee from "./marquee";

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

  if (settings.concept === "marquee") return <Marquee />;

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
