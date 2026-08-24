import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "@/features/auth/AuthProvider";
import InvitePage from "@/features/auth/InvitePage";
import LoginPage from "@/features/auth/LoginPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { RequireInvited } from "@/features/auth/RequireInvited";
import { RequireOnboarded } from "@/features/auth/RequireOnboarded";
import WelcomePage from "@/features/auth/WelcomePage";
import { LandingGate } from "@/features/landing/LandingGate";
import PrivacyPage from "@/features/legal/PrivacyPage";
import TermsPage from "@/features/legal/TermsPage";
import CalendarPage from "@/features/calendar/CalendarPage";
import ExplorePage from "@/features/explore/ExplorePage";
import CollectionPage from "@/features/explore/CollectionPage";
import ExportPage from "@/features/export/ExportPage";
import HistoryPage from "@/features/history/HistoryPage";
import ImportPage from "@/features/import/ImportPage";
import KitPage from "@/features/kit/KitPage";
import MoviesPage from "@/features/movies/MoviesPage";
import MoviesTonightPage from "@/features/movies/MoviesTonightPage";
import MovieReleasesPage from "@/features/movies/MovieReleasesPage";
import MoviesExplorePage from "@/features/movies/MoviesExplorePage";
import GamesPage from "@/features/games/GamesPage";
import SteamPage from "@/features/games/SteamPage";
import ShowsPage from "@/features/shows/ShowsPage";
import FriendPage from "@/features/social/FriendPage";
import FriendsPage from "@/features/social/FriendsPage";
import StatsPage from "@/features/social/StatsPage";
import PersonPage from "@/features/social/PersonPage";
import TastePage from "@/features/social/TastePage";
import TonightPage from "@/features/tonight/TonightPage";
import YouPage from "@/features/you/YouPage";
import { Shell } from "@/ui/shell/Shell";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { flashQueryError } from "@/ui/shell/queryErrorStore";
import { restoreMetadataCache, watchMetadataCache } from "@/lib/queryPersistence";
import "@/styles/index.css";
import "@/lib/settings"; // applies persisted theme/accent/density to <html> on boot

const queryClient = new QueryClient({
  // A failed query used to render as an empty state / eternal skeleton with no
  // signal. Surface a transient toast once retries are exhausted so it's visible.
  queryCache: new QueryCache({ onError: () => flashQueryError() }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Don't retry auth/permission errors; back off on the rest (max 2).
        const code = (error as { code?: string } | null)?.code;
        if (code && ["PGRST301", "42501", "PGRST116"].includes(code)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: { retry: 0 },
  },
});

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/kit", element: <KitPage /> }, // living style guide — public, static
  // Public legal pages — must stay outside the auth gate so signed-out visitors
  // (and Google's OAuth brand-verification reviewer) can reach them.
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/terms", element: <TermsPage /> },
  {
    path: "/invite",
    element: (
      <RequireAuth>
        <InvitePage />
      </RequireAuth>
    ),
  },
  {
    path: "/welcome",
    element: (
      <RequireAuth>
        <RequireInvited>
          <WelcomePage />
        </RequireInvited>
      </RequireAuth>
    ),
  },
  {
    path: "/",
    // LandingGate replaces RequireAuth here only: signed-out visitors see the
    // public landing at "/", while deep links still bounce to /login.
    element: (
      <LandingGate>
        <RequireInvited>
          <RequireOnboarded>
            <ErrorBoundary>
              <Shell />
            </ErrorBoundary>
          </RequireOnboarded>
        </RequireInvited>
      </LandingGate>
    ),
    children: [
      { index: true, element: <Navigate to="/tonight" replace /> },
      { path: "tonight", element: <TonightPage /> },
      { path: "shows", element: <ShowsPage /> },
      // El cine cuelga de /movies — el prefijo que lib/medium reconoce para que
      // un enlace compartido aterrice ya en su modo y con su acento. De momento
      // solo la biblioteca: Tonight, Releases y Explore de películas llegan en
      // su propia rama, y una ruta vacía no se publica.
      /* El cine, con la misma planta que las series: una portada, un
         calendario, la biblioteca y explorar.

         `/movies` a secas redirige a la portada en vez de ser la biblioteca,
         que es lo que era mientras fue la única pantalla. Dos motivos: deja el
         prefijo del modo (lib/medium) sin pantalla propia, como `/` en series,
         y evita que la pestaña de la biblioteca se encienda en las otras tres
         — un NavLink a "/movies" casa también con "/movies/tonight". */
      { path: "movies", element: <Navigate to="/movies/tonight" replace /> },
      { path: "movies/tonight", element: <MoviesTonightPage /> },
      { path: "movies/releases", element: <MovieReleasesPage /> },
      { path: "movies/watchlist", element: <MoviesPage /> },
      { path: "movies/explore", element: <MoviesExplorePage /> },

      /* Los juegos cuelgan de /games, el otro prefijo que lib/medium reconoce.
         Tres rutas y no cinco: "Esta noche" y "Explorar" llegan en su rodaja,
         igual que le pasó al cine. `/games` a secas redirige a la biblioteca,
         que aquí hace de portada por ser lo primero que hubo. */
      { path: "games", element: <Navigate to="/games/library" replace /> },
      { path: "games/library", element: <GamesPage /> },
      /* La vuelta del login de Steam aterriza aquí con ?steam=… — es una URL
         que escribe la edge function, así que la ruta no puede moverse sin
         mover también `return_to_origin` allí (0074). */
      { path: "games/steam", element: <SteamPage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "collection/:slug", element: <CollectionPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "you", element: <YouPage /> },
      { path: "friends", element: <FriendsPage /> },
      { path: "friends/taste", element: <TastePage /> },
      { path: "friends/stats", element: <StatsPage /> },
      // Old URL, kept as a redirect so shared/bookmarked links keep working.
      { path: "friends/kpis", element: <Navigate to="/friends/stats" replace /> },
      { path: "friend/:id", element: <FriendPage /> },
      { path: "person/:id", element: <PersonPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "settings/import", element: <ImportPage /> },
      { path: "export", element: <ExportPage /> },
    ],
  },
]);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

async function start() {
  // Hydrate durable metadata before mounting so a refresh paints from cache
  // instead of briefly entering the loading state and starting duplicate I/O.
  await restoreMetadataCache(queryClient);
  watchMetadataCache(queryClient);
  createRoot(rootElement!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
