/* Las reglas de producto de la importación, separadas de la red y de la base
 * para poder probarlas. Son tres, y las tres salen de que **las horas de Steam
 * son de por vida**: `playtime_forever` cuenta desde que abriste la cuenta, así
 * que dice cuánto has jugado a algo alguna vez y no dice nada sobre ahora.
 *
 *   1. Importar horas NO toca `play_state`. Derivar el estado de las horas
 *      metería en "Jugando" todo lo que abriste una tarde en 2016.
 *   2. Una cifra escrita a mano no se pisa sola. Para eso existe
 *      `minutes_source` desde 0073: 40 h de consola no las corrige un 12 de
 *      Steam, y la fila con las dos cifras y su casilla te lo pregunta.
 *   3. Lo que entra nuevo entra como `owned`, sin estado. Ver
 *      app/src/domain/gameStatus.ts: eso lo deja fuera de "Pendientes".
 */

/** Lo que devuelve GetOwnedGames por juego, ya limpio. */
export interface OwnedGame {
  appid: number;
  name: string;
  minutes: number;
}

/** Lo que la respuesta de Steam significa.
 *
 *  El caso que hay que distinguir a toda costa es `private`: un perfil que no
 *  es público devuelve **200 con `{"response":{}}`**, sin error y sin games. Si
 *  eso se lee como "no tienes juegos", la pantalla dice que tu cuenta está
 *  vacía y te deja buscando un fallo que no existe. Un perfil público sin
 *  juegos sí trae `game_count: 0`, y esa es la diferencia observable. */
export type OwnedGamesResult =
  | { kind: "ok"; games: OwnedGame[] }
  | { kind: "private" };

// deno-lint-ignore no-explicit-any
type Any = any;

export function parseOwnedGames(payload: Any): OwnedGamesResult {
  const response = payload?.response;
  if (!response || typeof response !== "object") return { kind: "private" };
  // Sin `game_count` NI `games` no hay forma de saber que la respuesta se
  // refiere a una biblioteca: es el cuerpo vacío del perfil cerrado.
  if (response.game_count === undefined && response.games === undefined) return { kind: "private" };

  const games: OwnedGame[] = [];
  for (const g of response.games ?? []) {
    const appid = Number(g?.appid);
    if (!Number.isInteger(appid) || appid < 1) continue;
    const minutes = Number(g?.playtime_forever);
    games.push({
      appid,
      // `include_appinfo=1` trae el nombre; sin él Steam manda solo el appid, y
      // una lista de números no se puede confirmar mirándola. El respaldo es
      // para que un juego retirado de la tienda no rompa la pantalla entera.
      name: typeof g?.name === "string" && g.name.trim() ? g.name.trim() : `App ${appid}`,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
    });
  }
  return { kind: "ok", games };
}

/** El estado de una fila de tu biblioteca frente a lo que dice Steam. */
export interface CurrentEntry {
  minutes: number | null | undefined;
  source: string | null | undefined;
}

/** ¿Esta fila es un conflicto — horas tuyas que Steam contradice?
 *
 *  Solo lo es si las escribiste TÚ (`minutes_source = 'manual'`), si hay algo
 *  que perder (> 0) y si las cifras difieren. Una fila que ya venía de Steam se
 *  reescribe sin preguntar: eso es lo que hace que volver a sincronizar sirva
 *  para algo. */
export function isConflict(current: CurrentEntry | null | undefined, steamMinutes: number): boolean {
  if (!current) return false;
  const mine = current.minutes ?? 0;
  return current.source === "manual" && mine > 0 && mine !== steamMinutes;
}

/** Los minutos que hay que escribir, o null para no tocar las horas de la fila.
 *
 *  `overwrite` es la casilla de ESA fila en la pantalla de confirmar, no un
 *  ajuste global: los conflictos son pocos y cada uno tiene su motivo.
 *
 *  Cuando sí escribe, escribe aunque la cifra coincida con la que había. No es
 *  un desperdicio: lo que cambia en ese caso es `minutes_source`, que pasa a
 *  'steam' y es lo que hace que la PRÓXIMA sincronización pueda actualizar esa
 *  fila sin volver a preguntar. Dejarla en 'manual' por casualidad la
 *  convertiría en un conflicto permanente. */
export function minutesToWrite(
  current: CurrentEntry | null | undefined,
  steamMinutes: number,
  overwrite: boolean,
): number | null {
  if (isConflict(current, steamMinutes) && !overwrite) return null;
  return steamMinutes;
}
