/* Con qué modo se abre Reel. Puro, con tests al lado (startPage.test.ts).

   La app abría siempre en "Esta noche" de series: la ruta "/" redirigía ahí y
   punto. Es una buena apuesta para quien ve series, y la equivocada para quien
   entra a mirar juegos o cine — un toque cada vez, siempre el mismo, en la
   pantalla que más veces se abre.

   Lo que se elige es el MODO, no la pantalla: siempre se abre en su portada,
   que es la misma que HOME de domain/mediumRoute — la que ya usa el conmutador
   de la barra cuando cruzas desde una sección que no existe al otro lado. Las
   tres responden la pregunta con la que se abre la app ("¿y ahora qué?"), así
   que elegir entre doce pantallas era ofrecer once formas de no empezar por la
   respuesta.

   Vive en domain y no dentro de lib/settings porque lo que llega de
   localStorage es de fuera y acaba decidiendo un navigate(): la lista de tres
   de abajo es lo que impide que storage editado a mano —o de una versión que
   guardaba otra cosa— mande la app adonde diga. */

import { HOME } from "@/domain/mediumRoute";
import type { Medium } from "@/domain/mediumCopy";

/** Con qué modo se abre si no has elegido: series, que es lo que la ruta "/"
 *  hacía cuando esto no se podía elegir. */
export const DEFAULT_START_MEDIUM: Medium = "tv";

export interface StartOption {
  medium: Medium;
  /** Clave del diccionario, no texto —traducir es de la capa que pinta—, y la
   *  misma que usa el conmutador de la barra: el ajuste nombra el modo con la
   *  palabra con la que se enciende ahí. */
  label: string;
}

/** Los tres modos, en el orden del conmutador. */
export const START_OPTIONS: readonly StartOption[] = [
  { medium: "tv", label: "TV" },
  { medium: "movie", label: "Movies" },
  { medium: "game", label: "Games" },
];

const ALLOWED = new Set<string>(START_OPTIONS.map((o) => o.medium));

/** El modo con el que abrir, a partir de lo que hubiera guardado. Cualquier
 *  cosa que no sea uno de los tres —ausente, de otro tipo, de una versión
 *  anterior que guardaba una ruta, o escrita a mano en storage— cae en series. */
export function resolveStartMedium(stored: unknown): Medium {
  return typeof stored === "string" && ALLOWED.has(stored)
    ? (stored as Medium)
    : DEFAULT_START_MEDIUM;
}

/** Y la ruta a la que lleva: la portada del modo, siempre. */
export function startRoute(stored: unknown): string {
  return HOME[resolveStartMedium(stored)];
}
