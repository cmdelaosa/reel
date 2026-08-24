import { useSyncExternalStore } from "react";

/* El medio en el que estás: series o cine.
 *
 * Es estado PEGAJOSO, no derivado de la ruta, y esa es la decisión de fondo:
 * Amigos, tu perfil, el historial y la ficha de una persona son las mismas
 * páginas en los dos modos, y si el medio se leyera de la URL, entrar en
 * Amigos desde el cine te devolvería al acento de series a mitad de sesión.
 * Así que el conmutador lo fija, localStorage lo recuerda, y las rutas de cine
 * lo re-afirman al abrirse para que un enlace compartido aterrice en su modo.
 *
 * Se aplica como `data-medium` en <html>, donde tokens.css lo lee para pisar
 * el acento elegido en Ajustes. Aplicado al importar, igual que las preferencias
 * de apariencia: un efecto de React lo pintaría un fotograma en coral.
 */

export type Medium = "tv" | "movie";

/** Prefijo de todas las rutas de cine — la mitad "ruta" del modo. */
export const MOVIE_PREFIX = "/movies";

export const isMoviePath = (pathname: string): boolean =>
  pathname === MOVIE_PREFIX || pathname.startsWith(`${MOVIE_PREFIX}/`);

const KEY = "reel.medium";

function load(): Medium {
  // Un enlace directo a /movies manda sobre lo guardado: es lo que la persona
  // acaba de pedir, y de lo contrario abriría el cine teñido de series.
  try {
    if (typeof location !== "undefined" && isMoviePath(location.pathname)) return "movie";
    return localStorage.getItem(KEY) === "movie" ? "movie" : "tv";
  } catch {
    return "tv";
  }
}

function apply(m: Medium) {
  document.documentElement.dataset.medium = m;
}

let medium = load();
apply(medium);
// Un enlace directo a /movies deja el modo puesto para la próxima visita, igual
// que si lo hubieras cambiado con el conmutador. Sin esto, entrar por el enlace
// y recargar desde cualquier otra página te devolvía a series.
if (medium === "movie") {
  try {
    localStorage.setItem(KEY, medium);
  } catch {
    /* sin almacenamiento → solo esta sesión */
  }
}

const listeners = new Set<() => void>();

export function getMedium(): Medium {
  return medium;
}

export function setMedium(next: Medium) {
  if (next === medium) return;
  medium = next;
  apply(medium);
  try {
    localStorage.setItem(KEY, medium);
  } catch {
    /* sin almacenamiento → solo esta sesión */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useMedium(): Medium {
  return useSyncExternalStore(subscribe, getMedium, getMedium);
}
