import { Navigate } from "react-router";
import { isPlaceholderHandle } from "@/lib/schemas";
import { useAuth } from "@/features/auth/AuthProvider";

/** Inside RequireInvited: users whose handle is still the signup-trigger
 *  placeholder must finish onboarding before entering the app. */
export function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();

  if (!profile) return null; // profile query in flight
  if (isPlaceholderHandle(profile.handle)) return <Navigate to="/welcome" replace />;
  return children;
}
