import { Navigate } from "react-router";
import { useInvited } from "@/features/auth/invited";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasCleared, inviteVerdict } from "@/features/auth/gates";

/** Inside RequireAuth: bounce un-invited users to the /invite gate.
 *
 *  Un `null` aquí no es una pantalla en blanco de medio segundo y ya: impide
 *  que se monte lo de dentro, así que las consultas de la pantalla ni se han
 *  pedido cuando el RPC contesta. De ahí la nota de gates.ts — el porqué, las
 *  medidas y lo que se acepta a cambio están todos allí. */
export function RequireInvited({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { data: invited } = useInvited();

  switch (inviteVerdict(invited, hasCleared(session?.user.id))) {
    case "bounce":
      return <Navigate to="/invite" replace />;
    case "wait":
      return null;
    case "enter":
      return children;
  }
}
