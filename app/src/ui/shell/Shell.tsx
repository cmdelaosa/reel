import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router";
import {
  Bell, CalendarClock, Clapperboard, Compass, LayoutGrid, Play, Search, Sliders, User,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { DetailSheet } from "@/features/detail/DetailSheet";
import { FriendSheet } from "@/features/social/FriendSheet";
import { useNotifications, useNotificationsRealtime } from "@/lib/notifications";
import { NotifPanel } from "@/ui/shell/NotifPanel";
import { Palette } from "@/ui/shell/Palette";
import { SettingsSheet } from "@/ui/shell/SettingsSheet";
import { OfflineToast } from "@/ui/shell/OfflineToast";

/* Marquee shell — top tab navigation, floating dock on mobile, ⌘K palette.
   Markup/classes ported verbatim from prototype/src/marquee.tsx. */

const TABS = [
  { path: "/tonight", label: "Tonight", icon: Clapperboard },
  { path: "/shows", label: "My Shows", icon: LayoutGrid },
  { path: "/explore", label: "Explore", icon: Compass },
  { path: "/calendar", label: "Calendar", icon: CalendarClock },
  { path: "/you", label: "You", icon: User },
] as const;

export function Shell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const titleParam = searchParams.get("title");
  const detailTmdbId = titleParam && /^\d+$/.test(titleParam) ? Number(titleParam) : null;
  const friendParam = searchParams.get("friend");

  const closeFriend = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("friend");
      return next;
    });

  const closeTitle = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("title");
      return next;
    });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  useNotificationsRealtime();
  const { data: notifications = [] } = useNotifications();
  const unread = notifications.filter((n) => !n.read_at).length;

  /** Open the detail sheet for a TMDB id via the global ?title= param (P2-C3). */
  const openTitle = (tmdbId: number) => {
    setPaletteOpen(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });
  };

  /* ⌘K / Ctrl-K opens the palette from anywhere */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const initial = (profile?.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="mq">
      {/* ---- Top bar ---- */}
      <header className="mq-top">
        <div className="mq-top-inner">
          <div className="mq-brand" onClick={() => navigate("/tonight")}>
            <span className="mq-brand-ico"><Play size={14} fill="currentColor" strokeWidth={0} /></span>
            <span className="mq-brand-name">Reel</span>
          </div>

          <nav className="mq-tabs">
            {TABS.map((t) => (
              <NavLink key={t.path} to={t.path} className={({ isActive }) => `mq-tab ${isActive ? "on" : ""}`}>
                <t.icon size={16} />
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mq-top-actions">
            <button className="mq-searchbtn" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span className="mq-searchbtn-label">Search</span>
              <kbd className="mq-kbd">⌘K</kbd>
            </button>
            <button className="btn btn-ghost btn-icon relative" title="Notifications" onClick={() => setNotifOpen((v) => !v)}>
              <Bell size={18} />
              {unread > 0 && <span className="mq-belldot" />}
            </button>
            <button className="btn btn-ghost btn-icon" title="Settings" onClick={() => setSettingsOpen(true)}>
              <Sliders size={18} />
            </button>
            <button className="mq-avatar" title="Your profile" onClick={() => navigate("/you")} style={{ overflow: "hidden", padding: 0 }}>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                initial
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ---- Content ---- */}
      <main className="mq-main">
        <Outlet />
      </main>

      {/* ---- Floating dock (mobile) ---- */}
      <nav className="mq-dock">
        {TABS.map((t) => (
          <NavLink key={t.path} to={t.path} className={({ isActive }) => `mq-dockbtn ${isActive ? "on" : ""}`} title={t.label}>
            <t.icon size={19} />
            <span className="mq-docklabel">{t.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* ---- Overlays ---- */}
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onOpen={openTitle} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} />}
      {friendParam && <FriendSheet friendId={friendParam} onClose={closeFriend} />}
      {/* key on the tmdb id so switching titles (⌘K, notification) while the
          sheet is open remounts it — otherwise stale season/pending/toast state
          carries over from the previous show. */}
      {detailTmdbId != null && (
        <DetailSheet key={detailTmdbId} tmdbId={detailTmdbId} onClose={closeTitle} />
      )}

      <OfflineToast />
    </div>
  );
}
