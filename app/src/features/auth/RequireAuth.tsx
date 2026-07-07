import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/features/auth/AuthProvider";

/** Route guard: everything except /login needs a session. Keeps the attempted
 *  location so LoginPage can bounce back after sign-in. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  if (session === undefined) return null; // restoring from storage — no flash
  if (session === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
