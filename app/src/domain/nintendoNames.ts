/* Qué es un juego y qué no, en el registro de Nintendo.
 *
 * El registro de juego mezcla juegos con dos cosas que no lo son, y las dos
 * salen en cuanto alguien mira su lista:
 *
 *   · las APPS de emulación de Nintendo Switch Online. Nintendo no lista los
 *     juegos retro de uno en uno: lista "Nintendo 64 – Nintendo Switch Online"
 *     como una entrada, con los minutos de todo lo que hayas jugado dentro. No
 *     es un juego, es un contenedor, y el propio Exophase avisa de que no hay
 *     forma de sacar lo que hay dentro.
 *   · las DEMOS, que sí son juegos pero no son TU juego: cuatro minutos de una
 *     demo no son algo que nadie quiera en su biblioteca.
 *
 * Esto NO filtra nada: las dos clases se enseñan en la pantalla de confirmar,
 * con sus minutos, y se pueden marcar. Lo único que hace es que no vengan
 * marcadas de antemano. La diferencia importa — un juego escondido es un juego
 * que la persona no sabe que existe, y "he jugado a esto y no aparece" es
 * exactamente la queja que esta pantalla tiene que no provocar.
 *
 * Vive en `domain/` y no en la edge function a propósito: es una decisión sobre
 * lo que se le ENSEÑA a alguien, y quien la toma es la pantalla. La función se
 * limita a traer lo que Nintendo diga.
 */

/** Las apps de emulación de Nintendo Switch Online y Nintendo Classics.
 *
 *  Se reconocen por el sufijo del catálogo, que Nintendo escribe igual en todas
 *  —con guion normal o con guion largo, que ahí no es consistente— y en cada
 *  idioma. Se compara sobre el nombre en minúsculas y sin los guiones, que es
 *  lo que sobrevive a esa inconsistencia.
 *
 *  Deliberadamente NO se listan las consolas una a una (NES, SNES, N64, Game
 *  Boy, GameCube, Mega Drive…): esa lista crece cada año, y una lista que hay
 *  que mantener al día es una lista que un día está vieja y deja de reconocer
 *  la app nueva. El sufijo es lo estable. */
export function isSystemApp(name: string): boolean {
  const flat = name.toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ");
  return flat.includes("nintendo switch online") || flat.includes("nintendo classics");
}

/** Una demo.
 *
 *  Con límite de palabra, que no es una precaución teórica: sin él,
 *  "Demolition" y cualquier juego con "demon" en el título —que son unos
 *  cuantos— entrarían aquí y se quedarían sin marcar sin que nadie entienda por
 *  qué. */
export function isDemo(name: string): boolean {
  return /\bdemos?\b/i.test(name);
}

/** ¿Viene marcado de antemano en la pantalla de confirmar?
 *
 *  Sí para lo que ya sigues —eso ya dijiste que te importa— y para los juegos
 *  de verdad. No para apps ni demos. */
export function suggestedByDefault(item: { name: string; in_library: boolean }): boolean {
  if (item.in_library) return true;
  return !isSystemApp(item.name) && !isDemo(item.name);
}
