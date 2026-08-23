import { useEffect, useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Bell, Bookmark, CalendarClock, Clapperboard, Compass, Film, Play, Search, Sliders, Tv, Users,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { DetailSheet } from "@/features/detail/DetailSheet";
import { useNotifications, useNotificationsRealtime } from "@/lib/notifications";
import { MOVIE_PREFIX, isMoviePath, setMedium, useMedium, type Medium } from "@/lib/medium";
import { MovieSheet } from "@/features/movies/MovieSheet";
import { NotifPanel } from "@/ui/shell/NotifPanel";
import { Palette } from "@/ui/shell/Palette";
import { SettingsSheet } from "@/ui/shell/SettingsSheet";
import { OfflineToast } from "@/ui/shell/OfflineToast";
import { QueryErrorToast } from "@/ui/shell/QueryErrorToast";
import { t } from "@/lib/i18n";

/* Marquee shell — top tab navigation, floating dock on mobile, ⌘K palette.
   Markup/classes ported verbatim from prototype/src/marquee.tsx. */

/* Watchlist is the library's front door, so it points at My Shows with the
   bucket already picked — ShowsPage reads it from ?filter=, which is also what
   makes the tab land on "Not started" when you're already on /shows. Its active
   state is the plain pathname one: switching buckets from there is filtering,
   not leaving, and a tab that went dark the moment you touched a chip would say
   otherwise. */
const TABS = [
  { path: "/tonight", label: "Tonight", icon: Clapperboard },
  { path: "/calendar", label: "Calendar", icon: CalendarClock },
  { path: "/shows?filter=watchlist", label: "Watchlist", icon: Bookmark },
  { path: "/explore", label: "Explore", icon: Compass },
  { path: "/friends", label: "Friends", icon: Users },
] as const;

/* El cine estrena por partes: aquí solo están las pestañas que existen. Tonight,
   Releases y Explore de películas llegan en su propia rama, y hasta entonces no
   se pintan — una pestaña que lleva a una pantalla vacía es peor que no tenerla.
   Amigos es LA MISMA página en los dos modos (solo cambia el acento), así que
   apunta a la misma ruta. */
const MOVIE_TABS = [
  { path: MOVIE_PREFIX, label: "Watchlist", icon: Bookmark },
  { path: "/friends", label: "Friends", icon: Users },
] as const;

/* El conmutador de la barra: TV | Movies, con el modo activo relleno de acento.
   Cambiar de modo es cambiar de sitio, no solo de color — así que además de
   fijar el medio te lleva a la portada de ese modo. Desde una página compartida
   (Amigos, tu perfil, una persona) no te mueve: son de los dos, y sacarte de
   donde estabas por teñir la pantalla sería un secuestro. */
function MediumSwitch() {
  const medium = useMedium();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const shared = !isMoviePath(pathname) && !TABS.some((t) => pathname.startsWith(t.path.split("?")[0]));

  const pick = (next: Medium) => {
    if (next === medium) return;
    setMedium(next);
    if (shared) return;
    navigate(next === "movie" ? MOVIE_PREFIX : "/tonight");
  };

  return (
    <div className="mq-medium" role="tablist" aria-label={t("Medium")}>
      {([["tv", Tv, "TV"], ["movie", Film, "Movies"]] as const).map(([key, Icon, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={medium === key}
          className={`mq-medium-seg ${medium === key ? "on" : ""}`}
          onClick={() => pick(key)}
        >
          <Icon size={15} />
          <span>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}

export function Shell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const titleParam = searchParams.get("title");
  const detailTmdbId = titleParam && /^\d+$/.test(titleParam) ? Number(titleParam) : null;
  // Ficha de película: parámetro propio, no ?title=. Un id de TMDB solo es
  // único dentro de su medio (0067), así que un único ?title= no podría decir
  // cuál de las dos abrir — y un enlace compartido acabaría en la otra.
  const movieParam = searchParams.get("movie");
  const movieTmdbId = movieParam && /^\d+$/.test(movieParam) ? Number(movieParam) : null;
  const medium = useMedium();
  const tabs = medium === "movie" ? MOVIE_TABS : TABS;

  const closeSheet = (param: "title" | "movie") => () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(param);
      return next;
    });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  useNotificationsRealtime();
  const { data: notifications = [] } = useNotifications();
  const unread = notifications.filter((n) => !n.read_at).length;

  /** Open the detail sheet for a TMDB id via the global ?title= param (P2-C3),
   *  or ?movie= when the palette was searching cinema. */
  const openTitle = (tmdbId: number) => {
    setPaletteOpen(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(medium === "movie" ? "movie" : "title", String(tmdbId));
      return next;
    });
  };

  /* Land at the top of every screen. Route changes otherwise inherit the window
     offset, and the calendar anchors itself thousands of pixels into its own
     feed — so leaving it dropped you into the middle of the next page, clamped
     to whatever that page's height allowed.
     Keyed on pathname, not the whole location: ?title= is modal state here, and
     resetting on it would yank the page to the top behind an opening sheet.
     Re-asserted after layout because the outgoing view's scroll anchoring can
     undo a single scrollTo — same reason PremieresList does it. */
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const id = setTimeout(() => window.scrollTo(0, 0), 0);
    return () => clearTimeout(id);
  }, [pathname]);

  /* The top bar carries no divider, so it needs the scroll position to know when
     to separate itself from the content passing under it. Same idiom as the
     landing nav. */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
      <header className={`mq-top ${scrolled ? "scrolled" : ""}${notifOpen ? " notif-open" : ""}`}>
        <div className="mq-top-inner">
          <div className="mq-brand" onClick={() => navigate("/tonight")}>
            <span className="mq-brand-ico"><Play size={14} fill="currentColor" strokeWidth={0} /></span>
            <span className="mq-brand-name">Reel</span>
          </div>

          <MediumSwitch />

          <nav className="mq-tabs">
            {tabs.map((tab) => (
              <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `mq-tab ${isActive ? "on" : ""}`}>
                <tab.icon size={16} />
                <span>{t(tab.label)}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mq-top-actions">
            <button className="mq-searchbtn" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span className="mq-searchbtn-label">{t("Search")}</span>
              <kbd className="mq-kbd">⌘K</kbd>
            </button>
            {/* The panel hangs off this wrapper, not off the window: the bar's
                content is centred in a 1280px column, so a viewport-anchored
                panel drifted further from its own bell the wider the screen
                got. Its scrim stays down in Overlays — fixed positioning inside
                the bar would be trapped by the bar's backdrop-filter. */}
            <span className="mq-bell-wrap">
              <button className="btn btn-ghost btn-icon relative" title={t("Notifications")} onClick={() => setNotifOpen((v) => !v)}>
                <Bell size={18} />
                {unread > 0 && <span className="mq-belldot" />}
              </button>
              {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} />}
            </span>
            <button className="btn btn-ghost btn-icon" title={t("Settings")} onClick={() => setSettingsOpen(true)}>
              <Sliders size={18} />
            </button>
            <button className="mq-avatar" title={t("Your profile")} onClick={() => navigate("/you")} style={{ overflow: "hidden", padding: 0 }}>
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
        {tabs.map((tab) => (
          <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `mq-dockbtn ${isActive ? "on" : ""}`} title={t(tab.label)}>
            <tab.icon size={19} />
            <span className="mq-docklabel">{t(tab.label)}</span>
          </NavLink>
        ))}
      </nav>

      {/* ---- Overlays ---- */}
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onOpen={openTitle} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {/* Click-anywhere-to-close for the bell panel. It sits below the bar's
          z-index so the bar (and the bell itself) stay live above it. */}
      {notifOpen && <div className="mq-notif-scrim" onClick={() => setNotifOpen(false)} />}
      {/* key on the tmdb id so switching titles (⌘K, notification) while the
          sheet is open remounts it — otherwise stale season/pending/toast state
          carries over from the previous show. */}
      {detailTmdbId != null && (
        <DetailSheet key={detailTmdbId} tmdbId={detailTmdbId} onClose={closeSheet("title")} />
      )}
      {movieTmdbId != null && (
        <MovieSheet key={movieTmdbId} tmdbId={movieTmdbId} onClose={closeSheet("movie")} />
      )}

      <OfflineToast />
      <QueryErrorToast />
    </div>
  );
}
