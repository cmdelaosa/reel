/* Con qué pantalla se abre Reel. Puro, con tests al lado (startPage.test.ts).

   La app abría siempre en "Esta noche" de series: la ruta "/" redirigía ahí y
   punto. Es una buena apuesta para quien ve series, y la equivocada para quien
   entra a mirar el backlog de juegos o los estrenos de cine — dos toques cada
   vez, siempre los mismos, en la pantalla que más veces se abre.

   Lo que se elige aquí es una de las doce casillas de la tabla de
   domain/mediumRoute (cuatro secciones × tres medios): las mismas rutas que ya
   viajan por el conmutador de modo, sin una copia nueva. Amigos y tu perfil no
   están a propósito — no son de un medio, y abrir la app en la actividad de
   otros no es abrir TU app.

   Vive en domain y no dentro de lib/settings porque es una decisión con tabla y
   con validación, y porque lo que llega de localStorage es de fuera: lo que se
   guarda es una RUTA, y una ruta sacada de storage acaba en un navigate(). Sin
   la lista blanca de abajo, storage editado a mano —o de una versión que
   guardaba otra cosa— manda a la app adonde diga. */

import { ROUTES, type Section } from "@/domain/mediumRoute";
import type { Medium } from "@/domain/mediumCopy";

/** Dónde se abre si no has elegido: la portada de series, que es lo que la ruta
 *  "/" hacía cuando esto no se podía elegir. */
export const DEFAULT_START = ROUTES.tonight.tv;

/** Cómo se llama cada casilla en el desplegable. Son las CLAVES del
 *  diccionario, no el texto —traducir es de la capa que pinta—, y son las
 *  mismas que las pestañas de ui/shell/Shell.tsx: el ajuste nombra la pestaña a
 *  la que lleva, con la palabra que esa pestaña usa en ese modo. Por eso
 *  "Releases" en cine y "games: Releases" en juegos, que no son dos sinónimos
 *  sino dos entradas distintas del diccionario. */
const LABELS: Record<Section, Record<Medium, string>> = {
  tonight: { tv: "Tonight", movie: "Tonight", game: "games: Tonight" },
  calendar: { tv: "Calendar", movie: "Releases", game: "games: Releases" },
  library: { tv: "Watchlist", movie: "Watchlist", game: "Backlog" },
  explore: { tv: "Explore", movie: "Explore", game: "Explore" },
};

const SECTIONS: readonly Section[] = ["tonight", "calendar", "library", "explore"];
const MEDIA: readonly Medium[] = ["tv", "movie", "game"];

export interface StartOption {
  /** La ruta que se guarda y a la que se navega. */
  route: string;
  /** Clave del diccionario con el nombre de la sección en ese medio. */
  label: string;
}

export interface StartGroup {
  medium: Medium;
  /** Clave del diccionario con el encabezado del grupo ("Shows", "Movies",
   *  "Games") — las mismas tres palabras que el conmutador de la barra. */
  label: string;
  options: StartOption[];
}

const PLURAL: Record<Medium, string> = { tv: "Shows", movie: "Movies", game: "Games" };

/** Las doce opciones agrupadas por medio, en el mismo orden que las pestañas.
 *  Agrupadas y no en una lista plana porque "Explorar" aparece tres veces con
 *  el mismo nombre: sin el encabezado del medio serían tres opciones idénticas. */
export const START_GROUPS: StartGroup[] = MEDIA.map((medium) => ({
  medium,
  label: PLURAL[medium],
  options: SECTIONS.map((section) => ({
    route: ROUTES[section][medium],
    label: LABELS[section][medium],
  })),
}));

const ALLOWED = new Set(START_GROUPS.flatMap((g) => g.options.map((o) => o.route)));

/** La ruta con la que abrir, a partir de lo que hubiera guardado. Cualquier
 *  cosa que no sea una de las doce —ausente, de otro tipo, de una versión
 *  anterior, o escrita a mano en storage— cae en la de siempre. */
export function resolveStart(stored: unknown): string {
  return typeof stored === "string" && ALLOWED.has(stored) ? stored : DEFAULT_START;
}
