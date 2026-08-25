/* Las reglas de producto de la importación de Nintendo, separadas de la red y
 * de la base para poder probarlas. Todas salen de lo que el registro de juego
 * DA y de lo que no da (ver 0080):
 *
 *   1. Da minutos acumulados DE POR VIDA. Igual que con Steam, de esa cifra no
 *      se deduce ningún estado: lo que la importación marca sola es `owned`, y
 *      el estado lo pone la persona en la pantalla de confirmar.
 *   2. NO da la última partida. Así que `played_at` se aprende: cuando los
 *      minutos suben respecto a la sincronización anterior, esa es la última
 *      partida. Ver `playedAtFor`.
 *   3. No da ningún identificador. Ni appid ni nada que se le parezca: solo el
 *      nombre, la carátula y la URL de la tienda. De ahí `externalIdOf`, que
 *      saca el nsuid de esa URL cuando lo hay, y `name:<normalizado>` cuando
 *      no — porque el borrador necesita una llave estable para que volver a
 *      escanear reconozca las mismas filas.
 */

// deno-lint-ignore no-explicit-any
type Any = any;

/** Un juego del registro, ya limpio. */
export interface NintendoGame {
  /** La llave del borrador. Ver `externalIdOf`. */
  externalId: string;
  name: string;
  /** Minutos acumulados de por vida. */
  minutes: number;
  imageUri: string | null;
}

/* ─────────────────────────── El código de amigo ─────────────────────────── */

const FRIEND_CODE = /^SW-\d{4}-\d{4}-\d{4}$/;

/** El código de amigo tal y como se guarda, o null si no lo es.
 *
 *  Acepta lo que una persona copia de verdad —con o sin el `SW-`, con espacios,
 *  con guiones raros o los doce dígitos a pelo— y devuelve siempre la misma
 *  forma. No es indulgencia: el código se lee de una consola y se teclea en un
 *  móvil, y rechazar "1839 0856 9768" por no llevar el prefijo es rechazar lo
 *  que la propia pantalla de Nintendo enseña separado.
 *
 *  Lo que NO hace es adivinar: doce dígitos son doce dígitos, y cualquier otra
 *  cosa es null y un mensaje, no un intento a ver si suena. */
export function normalizeFriendCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/^\s*sw[-\s]*/i, "").replace(/\D/g, "");
  if (digits.length !== 12) return null;
  const code = `SW-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
  return FRIEND_CODE.test(code) ? code : null;
}

/* ─────────────────────────── El registro de juego ───────────────────────── */

/** El nombre en la forma con la que se compara: sin acentos, sin símbolos de
 *  marca, sin dobles espacios y en minúsculas. Solo se usa como llave de
 *  respaldo cuando no hay nsuid — el nombre que se ENSEÑA es siempre el que
 *  mandó Nintendo. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** La llave estable de un juego del registro.
 *
 *  El nsuid de la tienda cuando la URL lo lleva —catorce dígitos, el
 *  identificador de verdad de un juego en el eShop— y `name:<normalizado>`
 *  cuando no. El respaldo por nombre no es bonito, pero es lo único que hay: sin
 *  llave, volver a escanear crearía filas nuevas para los mismos juegos y la
 *  pantalla de confirmar enseñaría cada juego dos veces.
 *
 *  El prefijo `name:` existe para que las dos clases de llave no puedan
 *  colisionar nunca, ni siquiera con un juego que se llamara "70010000012345". */
export function externalIdOf(game: { shopUri?: unknown; name: string }): string {
  const uri = typeof game.shopUri === "string" ? game.shopUri : "";
  const nsuid = uri.match(/(\d{10,})/)?.[1];
  return nsuid ?? `name:${normalizeName(game.name)}`;
}

/** Lo que devuelve `User/PlayLog/Show`, ya limpio.
 *
 *  Una fila rota no tira la lista entera: con veinte juegos, perder los veinte
 *  porque uno traiga el nombre en null es cambiar un juego que no se puede
 *  importar por una pantalla que dice que no has jugado a nada. */
export function parsePlayLog(payload: Any): NintendoGame[] {
  if (!Array.isArray(payload)) return [];
  const games: NintendoGame[] = [];
  const seen = new Set<string>();

  for (const g of payload) {
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (!name) continue;

    const externalId = externalIdOf({ shopUri: g?.shopUri, name });
    // Nintendo lista el mismo juego una vez, pero la llave de respaldo por
    // nombre sí puede repetirse (dos entradas con el mismo título y sin nsuid).
    // La primera gana: es la más reciente, porque el registro viene ordenado.
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const minutes = Number(g?.totalPlayTime);
    games.push({
      externalId,
      name,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
      imageUri: typeof g?.imageUri === "string" && g.imageUri ? g.imageUri : null,
    });
  }

  return games;
}

/* ─────────────────────────── La última partida, aprendida ───────────────── */

/** Cuándo se jugó por última vez, o null para no tocar `played_at`.
 *
 *  Nintendo no lo dice, así que se deduce de lo único observable: que los
 *  minutos hayan SUBIDO desde la vez anterior. Si suben, se ha jugado entre
 *  aquella sincronización y esta, y "ahora" es la mejor aproximación que
 *  existe — la misma que usa Exophase para su columna de última partida.
 *
 *  Los dos casos que devuelven null importan tanto como el que devuelve fecha:
 *
 *    · La PRIMERA importación (`previous` null) no sabe nada. Poner hoy sería
 *      decir que jugaste esta tarde a los veinte juegos del registro, y "Esta
 *      noche" se ordena por esa fecha: veinte juegos empatados arriba.
 *    · Los minutos iguales significan que no se ha tocado. Refrescar cada hora
 *      no puede convertir un juego abandonado en el más reciente.
 *
 *  Bajar tampoco es jugar: pasa cuando alguien borra el registro en la consola,
 *  y tratarlo como partida sería premiar el borrado. */
export function playedAtFor(
  previous: number | null | undefined,
  incoming: number,
  now = new Date(),
): string | null {
  if (previous === null || previous === undefined) return null;
  if (!(incoming > previous)) return null;
  return now.toISOString();
}
