import { useEffect, useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Bell, Bookmark, CalendarClock, Compass, Film, Gamepad2, Play, Search,
  Sliders, Sparkles, Tv, Users,
} from "lucide-react";
import { SteamIcon } from "@/ui/icons/SteamIcon";
import { useAuth } from "@/features/auth/AuthProvider";
import { DetailSheet } from "@/features/detail/DetailSheet";
import { useNotifications, useNotificationsRealtime } from "@/lib/notifications";
import { mediumOfPath, setMedium, useMedium, type Medium } from "@/lib/medium";
import { routeForMedium } from "@/domain/mediumRoute";
import { MovieSheet } from "@/features/movies/MovieSheet";
import { GameSheet } from "@/features/games/GameSheet";
import { NotifPanel } from "@/ui/shell/NotifPanel";
import { Palette } from "@/ui/shell/Palette";
import { SettingsSheet } from "@/ui/shell/SettingsSheet";
import { TopTabs } from "@/ui/shell/TopTabs";
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
/* El destello y no la claqueta. La claqueta estaba en las tres listas, o sea
   que decía "cine" en la portada de las series y en la de los juegos — y ni
   siquiera en Cine acertaba, porque esta pestaña no es "una película", es la
   portada del modo. El destello dice lo único que las tres portadas tienen en
   común: esto es lo elegido para ti, ahora. */
/* ⚠️ Las rutas de estas tres listas están escritas también en la tabla de
   domain/mediumRoute, que es por donde cruza el conmutador. Se tocan juntas:
   main.tsx no tiene ruta comodín, así que renombrar una ruta en un solo sitio
   no da error — deja la pantalla en blanco bajo la barra. */
const TABS = [
  { path: "/tonight", label: "Tonight", icon: Sparkles },
  { path: "/calendar", label: "Calendar", icon: CalendarClock },
  { path: "/shows?filter=watchlist", label: "Watchlist", icon: Bookmark },
  { path: "/explore", label: "Explore", icon: Compass },
  { path: "/friends", label: "Friends", icon: Users },
] as const;

/* Las cinco de series menos una: no hay "Calendario" y "Estrenos" a la vez,
   porque en cine son la misma pantalla. Amigos es LA MISMA página en los dos
   modos (solo cambia el acento), así que apunta a la misma ruta — y por eso
   aparece en las dos listas, que es lo que SHARED_PATHS detecta abajo. */
const MOVIE_TABS = [
  { path: "/movies/tonight", label: "Tonight", icon: Sparkles },
  { path: "/movies/releases", label: "Releases", icon: CalendarClock },
  { path: "/movies/watchlist", label: "Watchlist", icon: Bookmark },
  { path: "/movies/explore", label: "Explore", icon: Compass },
  { path: "/friends", label: "Friends", icon: Users },
] as const;

/* Las cinco, como los otros dos modos. Amigos es LA MISMA página en los tres
   (solo cambia el acento), así que apunta a la misma ruta — y por eso aparece
   en las tres listas, que es lo que SHARED_PATHS detecta abajo.

   "Lanzamientos" y no "Estrenos": un juego no se estrena, sale.

   "Pendientes" ocupa el sitio que en los otros dos modos ocupa "Watchlist", y
   se llama distinto a propósito: es LA palabra que usa quien juega para lo que
   tiene por jugar, y además es el nombre del cubo al que la pestaña lleva, así
   que la pestaña y el chip dicen lo mismo. "Playlist" habría rimado con las
   otras dos y significado otra cosa — en una app de tres medios se lee como
   música.

   Y una SEXTA, que rompe la simetría de los tres modos a sabiendas: "Steam".
   No es una preferencia que quepa en los ajustes — es una pantalla con tres
   pasos (conectar, ver qué va a entrar, confirmar) a la que se vuelve cada vez
   que quieres traer horas nuevas, y es del modo Juegos y de ningún otro, que es
   exactamente lo que una pestaña de aquí significa. Va la última de las de
   juegos, antes de Amigos: es la que menos se abre de las cinco. En móvil la
   fila ya scrollea en horizontal, y el TabMenu recoge lo que no quepa. */
/* Y "A jugar" donde los otros dos modos dicen "Esta noche". Clave con prefijo,
   como "games: Releases", así que solo cambia aquí.

   "Esta noche" es la pregunta de los otros dos, no la de este: la portada de
   Juegos no elige nada —su héroe sale de pickResume y su antetítulo ya dice
   "Por dónde ibas"—, y para elegir está Pendientes. Y una partida no cabe en
   una noche: son treinta horas repartidas en semanas, así que la hora del día
   no es la unidad. Lo que queda dicho es la invitación, que es lo que "Esta
   noche" hace en los otros dos: no nombra la pantalla, propone el rato. */
const GAME_TABS = [
  { path: "/games/tonight", label: "games: Tonight", icon: Sparkles },
  { path: "/games/releases", label: "games: Releases", icon: CalendarClock },
  { path: "/games/backlog", label: "Backlog", icon: Bookmark },
  { path: "/games/explore", label: "Explore", icon: Compass },
  // El logotipo de Steam, y no el eslabón de cadena que decía "cuenta
  // enlazada": el mando ya nombra al MODO en el conmutador de la barra, así que
  // la pestaña no tiene que decir "juegos" otra vez — pero tampoco tiene que
  // decir "enlace" en abstracto pudiendo decir de QUÉ enlace se trata, que es
  // lo único que la marca hace mejor que cualquier pictograma.
  { path: "/games/steam", label: "Steam", icon: SteamIcon },
  { path: "/friends", label: "Friends", icon: Users },
] as const;

/* Las rutas que son de UN medio: cambiar de modo desde ellas te lleva a la
   portada del otro, porque quedarte sería quedarte en una pantalla del modo que
   acabas de dejar. Todo lo demás —Amigos, tu perfil, una persona, el historial—
   es de los dos: ahí el conmutador solo tiñe, y sacarte de donde estabas por
   cambiar de color sería un secuestro.

   /friends está en las dos listas de pestañas y por eso se comprueba aparte: es
   la página compartida que además tiene pestaña, y mirar solo TABS la contaba
   como de series. */
const SHARED_PATHS = [...MOVIE_TABS, ...GAME_TABS]
  .filter((m) => TABS.some((t) => t.path === m.path))
  .map((t) => t.path);

const ownedByAMedium = (pathname: string): boolean => {
  if (SHARED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (mediumOfPath(pathname)) return true;
  return TABS.some((t) => pathname.startsWith(t.path.split("?")[0]));
};

/* El conmutador de la barra: TV | Movies | Games, con el modo activo relleno de
   acento. Cambiar de modo es cambiar de sitio, no solo de color.

   Tres segmentos caben donde cabían dos porque los rótulos son cortos; en
   móvil el contenedor ya scrollea en horizontal si hiciera falta. */
function MediumSwitch() {
  const medium = useMedium();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  /* Y cambiar de sitio es cruzar a la MISMA sección del otro medio, no volver
     siempre a su portada: si estabas explorando juegos y pulsas Series, sigues
     explorando. La tabla de equivalencias —y qué pasa con lo que solo existe en
     un medio, como Steam— vive en domain/mediumRoute, con sus pruebas. */
  const pick = (next: Medium) => {
    if (next === medium) return;
    setMedium(next);
    if (!ownedByAMedium(pathname)) return;
    navigate(routeForMedium(pathname, next));
  };

  return (
    <div className="mq-medium" role="radiogroup" aria-label={t("Medium")}>
      {([["tv", Tv, "TV"], ["movie", Film, "Movies"], ["game", Gamepad2, "Games"]] as const).map(([key, Icon, label]) => (
        <button
          key={key}
          role="radio"
          aria-checked={medium === key}
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
  // Y la de un juego: `?game=` lleva un id de IGDB, que vive en otro espacio de
  // numeración que los de TMDB (0071). Tres parámetros y no uno por la misma
  // razón que había dos.
  const gameParam = searchParams.get("game");
  const gameIgdbId = gameParam && /^\d+$/.test(gameParam) ? Number(gameParam) : null;
  const medium = useMedium();
  const tabs = medium === "movie" ? MOVIE_TABS : medium === "game" ? GAME_TABS : TABS;

  /* El conmutador fija el medio, pero no es el único que mueve la ruta: Atrás y
     Adelante también. Sin esto, volver desde /tonight a /movies dejaba la
     biblioteca de cine pintada en coral y bajo las pestañas de series — la ruta
     decía una cosa y el modo otra. Solo las rutas de UN medio hablan; desde una
     compartida (Amigos, tu perfil) el modo se queda como estaba, que es lo que
     hace que teñirlas signifique algo. */
  useEffect(() => {
    const owner = mediumOfPath(pathname);
    if (owner) setMedium(owner);
    else if (ownedByAMedium(pathname)) setMedium("tv");
  }, [pathname]);

  const closeSheet = (param: "title" | "movie" | "game") => () =>
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
      next.set(medium === "movie" ? "movie" : medium === "game" ? "game" : "title", String(tmdbId));
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

          {/* El carril se mide a sí mismo y recoge en un menú lo que no quepa:
              ui/shell/TopTabs. Cambiar de modo cambia la identidad de `tabs`, y
              eso es lo que le dice que vuelva a medir — los rótulos de Juegos
              son seis y más largos que los cinco de Series. */}
          <TopTabs tabs={tabs} />

          <div className="mq-top-actions">
            <button className="mq-searchbtn" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span className="mq-searchbtn-label">{t("Search")}</span>
              <kbd className="mq-kbd">⌘K</kbd>
            </button>
            {/* The panel hangs off this wrapper, not off the window: back when
                the bar's content sat in a centred 1280px column, a
                viewport-anchored panel drifted further from its own bell the
                wider the screen got. That column is gone —the bar spans the
                window now— so today the two land in the same place; the anchor
                stays because the panel belongs to ITS bell, which is what has
                to keep being true the next time the bar moves. Its scrim stays
                down in Overlays — fixed positioning inside the bar would be
                trapped by the bar's backdrop-filter. */}
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
      {gameIgdbId != null && (
        <GameSheet key={gameIgdbId} igdbId={gameIgdbId} onClose={closeSheet("game")} />
      )}

      <OfflineToast />
      <QueryErrorToast />
    </div>
  );
}
