/* Las reglas de producto de la importación, separadas de la red y de la base
 * para poder probarlas. Salen casi todas de que **las horas de Steam son de por
 * vida**: `playtime_forever` cuenta desde que abriste la cuenta, así que dice
 * cuánto has jugado a algo alguna vez y no dice nada sobre ahora.
 *
 *   1. Importar horas NO toca `play_state`. Derivar el estado de las horas
 *      metería en "Jugando" todo lo que abriste una tarde en 2016. Lo que sí
 *      lo toca es lo que la PERSONA marca en la pantalla de confirmar (0078),
 *      que es un dato distinto: no se deduce de ninguna cifra.
 *   2. Una cifra escrita a mano no se pisa sola. Para eso existe
 *      `minutes_source` desde 0073: 40 h de consola no las corrige un 12 de
 *      Steam, y la fila con las dos cifras y su casilla te lo pregunta.
 *   3. Lo que entra nuevo entra como `owned`, sin estado, salvo que la persona
 *      diga otra cosa. Ver app/src/domain/gameStatus.ts: eso lo deja fuera de
 *      "Pendientes".
 *
 * Y una cuarta desde 0078, que sale de que Steam también da la ÚLTIMA PARTIDA:
 *
 *   4. Lo que marcas como terminado se fecha con `rtime_last_played` y no con
 *      hoy. Ver `finishedAt`.
 *
 * ── Lo que ya no vive aquí ───────────────────────────────────────────────
 * Las reglas 1 a 3 no son de Steam: son de importar juegos, y desde 0080 hay
 * dos proveedores que las cumplen igual. Se mudaron a
 * `_shared/game-import.ts` y se reexportan desde aquí, que es lo que deja
 * intactos a index.ts y a merge_test.ts — este fichero sigue siendo el sitio
 * donde se busca "las reglas de la importación de Steam", y ahora además dice
 * cuáles no son suyas.
 */

export {
  type CurrentEntry,
  isConflict,
  minutesToWrite,
  type Pick,
  parsePick,
} from "../_shared/game-import.ts";

/** Lo que devuelve GetOwnedGames por juego, ya limpio. */
export interface OwnedGame {
  appid: number;
  name: string;
  minutes: number;
  /** La última vez que lo abriste, en ISO, o null si Steam dice que nunca.
   *
   *  Viene de `rtime_last_played` en la MISMA respuesta que las horas: ni una
   *  petición más. Es la fecha con la que se escribe el watch_event de lo que
   *  marques como terminado — ver `finishedAt`. */
  lastPlayed: string | null;
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
      lastPlayed: lastPlayedOf(g?.rtime_last_played),
    });
  }
  return { kind: "ok", games };
}

/** `rtime_last_played` como ISO, o null.
 *
 *  Segundos unix, no milisegundos. El 0 —que es lo que trae todo lo que nunca
 *  has abierto— es "nunca" y no el 1 de enero de 1970: pasarlo tal cual haría
 *  que un juego terminado se fechara en la era de Nixon y se colara el primero
 *  en un historial ordenado por fecha. Lo de más allá de mañana también se
 *  descarta: un reloj que va mal no puede meter un evento en el futuro, donde
 *  ninguna lista lo enseña y nadie lo puede corregir. */
export function lastPlayedOf(rtime: unknown, now = Date.now()): string | null {
  const seconds = Number(rtime);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = Math.round(seconds) * 1000;
  if (ms > now + 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

/** Con qué fecha se escribe el watch_event de un juego que marcas terminado.
 *
 *  La última partida cuando la hay, y `now` cuando no. Ese respaldo no es un
 *  apaño: un juego con 0 h que marcas terminado a mano lo estás terminando
 *  ahora mismo. Lo que el respaldo NO puede ser es la regla general — 41 juegos
 *  con fecha de hoy es un muro que dice que te acabaste once juegos esta tarde
 *  y un historial que no sirve para nada. */
export function finishedAt(lastPlayed: string | null | undefined, now = new Date()): string {
  return lastPlayed ?? now.toISOString();
}

