import { Navigate } from "react-router";
import { useInvited } from "@/features/auth/invited";

/** Inside RequireAuth: bounce un-invited users to the /invite gate. */
export function RequireInvited({ children }: { children: React.ReactNode }) {
  const { data: invited, isPending } = useInvited();

  if (isPending) return null; // one quick RPC — no flash
  if (!invited) return <Navigate to="/invite" replace />;
  return children;
}
