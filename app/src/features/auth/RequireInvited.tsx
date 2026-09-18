import { useEffect } from "react";
import { Navigate } from "react-router";
import { useInvited } from "@/features/auth/invited";
import { useAuth } from "@/features/auth/AuthProvider";
import { forgetCleared, hasCleared, inviteVerdict } from "@/features/auth/gates";

/** Inside RequireAuth: bounce un-invited users to the /invite gate.
 *
 *  Un `null` aquí no es una pantalla en blanco de medio segundo y ya: impide
 *  que se monte lo de dentro, así que las consultas de la pantalla ni se han
 *  pedido cuando el RPC contesta. De ahí la nota de gates.ts — el porqué, las
 *  medidas y lo que se acepta a cambio están todos allí. */
export function RequireInvited({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { data: invited, isError } = useInvited();

  /* Una invitación revocada tiene que borrar la nota, o cada carga futura le
     enseña la app un instante antes del mismo rebote. Se sabe aquí y en ningún
     otro sitio: es el único que ve el `false`. */
  const revoked = invited === false;
  useEffect(() => {
    if (revoked) forgetCleared();
  }, [revoked]);

  switch (inviteVerdict(invited, hasCleared(session?.user.id), isError)) {
    case "bounce":
      return <Navigate to="/invite" replace />;
    case "wait":
      return null;
    case "enter":
      return children;
  }
}
