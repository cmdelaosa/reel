import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasCleared, markCleared, onboardVerdict } from "@/features/auth/gates";

/** Inside RequireInvited: users whose handle is still the signup-trigger
 *  placeholder must finish onboarding before entering the app.
 *
 *  Es el segundo y último portero, así que la nota del aparato se escribe aquí:
 *  llegar a un perfil con alias propio significa que la invitación también pasó
 *  —este componente cuelga del otro—, y son las dos preguntas de una vez. El
 *  porqué de la nota, en gates.ts. */
export function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const verdict = onboardVerdict(profile?.handle, hasCleared(userId));

  /* En un efecto y no en el cuerpo: escribir en localStorage mientras se
     renderiza es un efecto secundario a medio render, y con StrictMode se
     ejecuta dos veces. Aquí no rompería nada —es idempotente—, pero la regla
     vale para el día que deje de serlo. */
  const entering = verdict === "enter" && profile !== undefined;
  useEffect(() => {
    if (entering && userId) markCleared(userId);
  }, [entering, userId]);

  switch (verdict) {
    case "bounce":
      return <Navigate to="/welcome" replace />;
    case "wait":
      return null;
    case "enter":
      return children;
  }
}
