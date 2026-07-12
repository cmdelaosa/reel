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
import CalendarPage from "@/features/calendar/CalendarPage";
import ExplorePage from "@/features/explore/ExplorePage";
import CollectionPage from "@/features/explore/CollectionPage";
import ExportPage from "@/features/export/ExportPage";
import HistoryPage from "@/features/history/HistoryPage";
import ImportPage from "@/features/import/ImportPage";
import KitPage from "@/features/kit/KitPage";
import ShowsPage from "@/features/shows/ShowsPage";
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
    element: (
      <RequireAuth>
        <RequireInvited>
          <RequireOnboarded>
            <ErrorBoundary>
              <Shell />
            </ErrorBoundary>
          </RequireOnboarded>
        </RequireInvited>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/tonight" replace /> },
      { path: "tonight", element: <TonightPage /> },
      { path: "shows", element: <ShowsPage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "collection/:slug", element: <CollectionPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "you", element: <YouPage /> },
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
