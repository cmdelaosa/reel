/* Los dos porteros de la entrada, y lo que deciden.
 *
 * EL PROBLEMA QUE RESUELVEN, y el que causaban. Entre la sesión y la app hay
 * dos preguntas al servidor: ¿esta cuenta canjeó una invitación? y ¿terminó de
 * darse de alta? Las dos se contestaban pintando `null` mientras tanto, para no
 * enseñar la app a quien luego iba a salir rebotado.
 *
 * Eso cambiaba un parpadeo por una espera, y la espera era peor de lo que
 * parecía: `null` no es solo una pantalla en blanco, es que lo de dentro NO SE
 * MONTA — así que las consultas de la pantalla ni siquiera se habían pedido
 * todavía. Medido en producción el 18-sep-2026, con el JS ya en caché:
 *
 *     is_invited        58 → 107 ms
 *     profiles          58 → 327 ms
 *     rpc_up_next      345 → 521 ms   ← no arranca hasta que profiles contesta
 *     titles/providers 540 → 597 ms
 *     primer píxel                      1248 ms
 *
 * Cuatro viajes en fila india y la pantalla en blanco hasta el final, cuando el
 * JS estaba listo a los 35 ms.
 *
 * LA SALIDA. Las dos respuestas son hechos pegajosos: quien canjeó su
 * invitación no la des-canjea, y quien eligió su alias no vuelve al
 * marcador de posición. Así que la primera vez que una cuenta pasa por aquí se
 * anota en ESTE aparato, y a partir de entonces se entra de primeras mientras
 * la comprobación viaja por detrás. Si volviera que no, se rebota igual.
 *
 * Lo que se acepta a cambio: a quien se le revoque la invitación entre dos
 * cargas, en este aparato, verá la app un instante antes del rebote. Es
 * asumible porque este portero nunca fue el muro — los datos los guarda RLS,
 * como dice invited.ts — y porque el aviso lo da igual, medio segundo después.
 *
 * Lo que NO se acepta y por eso está en la tabla de pruebas: entrar cuando la
 * respuesta ya llegó y dice que no. La anotación solo cubre el hueco de la
 * espera, nunca contradice una respuesta.
 */

import { isPlaceholderHandle } from "@/lib/schemas";

/** Qué hacer con quien llama a la puerta. */
export type Verdict =
  /** Adelante. */
  | "enter"
  /** Todavía no se sabe y no hay nota de este aparato: pantalla en blanco. */
  | "wait"
  /** Fuera, a la pantalla que le toque. */
  | "bounce";

/**
 * El portero de la invitación.
 *
 * `invited` es `undefined` mientras el RPC viaja. `cleared` es la nota de este
 * aparato.
 */
export function inviteVerdict(invited: boolean | undefined, cleared: boolean): Verdict {
  if (invited === true) return "enter";
  if (invited === false) return "bounce";
  return cleared ? "enter" : "wait";
}

/**
 * El portero del alta.
 *
 * `handle` es el alias del perfil, `undefined` mientras la consulta viaja. El
 * alias que pone el disparador del alta es un marcador de posición: quien lo
 * lleva todavía no ha elegido el suyo y va a /welcome.
 */
export function onboardVerdict(handle: string | undefined, cleared: boolean): Verdict {
  if (handle === undefined) return cleared ? "enter" : "wait";
  return isPlaceholderHandle(handle) ? "bounce" : "enter";
}

/* ── la nota de este aparato ──────────────────────────────────────────────── */

const KEY = "reel.gates.cleared";

/* Se guarda el id de la cuenta y no un simple "sí": en un aparato compartido,
   la nota de una cuenta no puede abrirle la puerta a la siguiente. */
function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // navegación privada o almacenamiento denegado: se espera, y ya.
  }
}

/** ¿Ha pasado ya esta cuenta por los dos porteros en este aparato? */
export function hasCleared(userId: string | undefined): boolean {
  return userId !== undefined && read() === userId;
}

/** Anota que los ha pasado. Idempotente: se llama en cada render que entra. */
export function markCleared(userId: string): void {
  if (read() === userId) return;
  try {
    localStorage.setItem(KEY, userId);
  } catch {
    // Sin almacenamiento se entra igual, solo que esperando como antes.
  }
}

/** Borra la nota. Al cerrar sesión, con el resto del rastro de la cuenta. */
export function forgetCleared(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nada que borrar si no se pudo escribir.
  }
}
