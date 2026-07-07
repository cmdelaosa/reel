import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import ImportPage from "@/features/import/ImportPage";
import KitPage from "@/features/kit/KitPage";
import ShowsPage from "@/features/shows/ShowsPage";
import TonightPage from "@/features/tonight/TonightPage";
import YouPage from "@/features/you/YouPage";
import { Shell } from "@/ui/shell/Shell";
import "@/styles/index.css";
import "@/lib/settings"; // applies persisted theme/accent/density to <html> on boot

const queryClient = new QueryClient();

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
            <Shell />
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

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
