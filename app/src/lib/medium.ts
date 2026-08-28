import { useSyncExternalStore } from "react";
import { getSettings } from "@/lib/settings";
import { resolveStartMedium } from "@/domain/startPage";

/* El medio en el que estás: series, cine o videojuegos.
 *
 * Es estado PEGAJOSO, no derivado de la ruta, y esa es la decisión de fondo:
 * Amigos, tu perfil, el historial y la ficha de una persona son las mismas
 * páginas en los tres modos, y si el medio se leyera de la URL, entrar en
 * Amigos desde el cine te devolvería al acento de series a mitad de sesión.
 * Así que el conmutador lo fija, localStorage lo recuerda, y las rutas de un
 * medio lo re-afirman al abrirse para que un enlace compartido aterrice en su
 * modo.
 *
 * Se aplica como `data-medium` en <html>, donde tokens.css lo lee para pisar
 * el acento elegido en Ajustes. Aplicado al importar, igual que las preferencias
 * de apariencia: un efecto de React lo pintaría un fotograma en coral.
 */

export type Medium = "tv" | "movie" | "game";

/** Prefijo de las rutas de cada medio con casa propia — la mitad "ruta" del
 *  modo. Series no tiene: es la raíz, por ser el medio con el que nació la app. */
export const MOVIE_PREFIX = "/movies";
export const GAME_PREFIX = "/games";

const underPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isMoviePath = (pathname: string): boolean => underPrefix(pathname, MOVIE_PREFIX);
export const isGamePath = (pathname: string): boolean => underPrefix(pathname, GAME_PREFIX);

/** El medio dueño de una ruta, o null si es de las compartidas. */
export function mediumOfPath(pathname: string): Medium | null {
  if (isMoviePath(pathname)) return "movie";
  if (isGamePath(pathname)) return "game";
  return null;
}

const KEY = "reel.medium";
const MEDIA: readonly Medium[] = ["tv", "movie", "game"];
const isMedium = (v: unknown): v is Medium => MEDIA.includes(v as Medium);

function load(): Medium {
  // Un enlace directo a /movies o /games manda sobre lo guardado: es lo que la
  // persona acaba de pedir, y de lo contrario abriría el cine teñido de series.
  try {
    if (typeof location !== "undefined") {
      const fromPath = mediumOfPath(location.pathname);
      if (fromPath) return fromPath;
      /* "/" no es de ningún medio, pero desde que la pantalla de inicio se
         elige tampoco es de series: redirige a la portada del modo elegido en
         Ajustes. Sin esta línea, quien abre en Cine o en Juegos y cerró la
         sesión anterior en Series veía el primer fotograma teñido de coral
         antes de que el Shell reafirmara el modo — el mismo fotograma que el
         comentario de arriba explica que este módulo existe para evitar. */
      if (location.pathname === "/") return resolveStartMedium(getSettings().startMedium);
    }
    const stored = localStorage.getItem(KEY);
    return isMedium(stored) ? stored : "tv";
  } catch {
    return "tv";
  }
}

function apply(m: Medium) {
  document.documentElement.dataset.medium = m;
}

let medium = load();
apply(medium);
// Un enlace directo deja el modo puesto para la próxima visita, igual que si lo
// hubieras cambiado con el conmutador. Sin esto, entrar por el enlace y recargar
// desde cualquier otra página te devolvía a series.
if (medium !== "tv") {
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
