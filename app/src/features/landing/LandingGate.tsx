import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/features/auth/AuthProvider";
import LandingPage from "@/features/landing/LandingPage";

/** Route guard for the "/" tree. Signed-out visitors get the marketing landing
 *  at the root URL itself (no redirect); deep links (/calendar, /friend/…) keep
 *  the old behavior of bouncing to /login with the attempted location so
 *  sign-in can return there. Signed-in users fall through to the app chain. */
export function LandingGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  if (session === undefined) return null; // restoring from storage — no flash
  if (session === null) {
    if (location.pathname === "/") return <LandingPage />;
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
