import { Navigate } from "react-router";
import { getSettings } from "@/lib/settings";
import { resolveStart } from "@/domain/startPage";

/* Qué hay en "/": la pantalla que hayas elegido en Ajustes, y "Esta noche" de
   series mientras no elijas — que es lo que había aquí escrito a pelo.

   `getSettings()` y no `useSettings()`: esto no se queda montado ni un pintado,
   redirige y desaparece, así que suscribirse no tendría a quién avisar. Y
   `resolveStart` otra vez, aunque settings ya valide al cargar, porque este es
   el punto donde una ruta se convierte en navegación: la comprobación va donde
   se usa, no solo donde se guarda. */
export function StartRedirect() {
  return <Navigate to={resolveStart(getSettings().start)} replace />;
}
