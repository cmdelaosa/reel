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
 */

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

/** Lo que la pantalla de confirmar manda por juego, ya limpio.
 *
 *  Llega del navegador, así que aquí no se fía nada: un `state` que no sea uno
 *  de los cinco se queda en null —o sea, "lo tengo y no he dicho nada", el
 *  defecto de 0076— y una nota que no sea un entero de 1 a 10 no se escribe.
 *  Sin esto, un cliente cualquiera podría meter un play_state que la comprueba
 *  de la tabla rechaza y tirar la importación entera por una fila. */
export interface Pick {
  id: string;
  /** La casilla de la fila en conflicto: ceder ESA fila a las horas de Steam. */
  overwrite: boolean;
  /** Lo que se escribe en `library_entries.play_state`. Null es no tocarlo. */
  playState: "backlog" | "playing" | "ongoing" | "dropped" | null;
  /** Terminado NO es un play_state: es el watch_event (0073). Por eso viaja
   *  aparte y no dentro de `playState`. */
  finished: boolean;
  /** 1..10, o null para no puntuar. */
  rating: number | null;
}

const PLAY_STATES = ["backlog", "playing", "ongoing", "dropped"] as const;

export function parsePick(raw: Any): Pick | null {
  if (typeof raw?.id !== "string" || !raw.id) return null;
  const state = typeof raw?.state === "string" ? raw.state : null;
  /* La nota tiene que llegar como NÚMERO. Un "9" de texto es un cliente roto,
     y aceptarlo con un Number() por medio esconde la avería en vez de que se
     vea el día que aparece. */
  const score = typeof raw?.rating === "number" ? raw.rating : NaN;
  return {
    id: raw.id,
    overwrite: Boolean(raw?.overwrite),
    playState: (PLAY_STATES as readonly string[]).includes(state ?? "")
      ? (state as Pick["playState"])
      : null,
    finished: state === "finished",
    rating: Number.isInteger(score) && score >= 1 && score <= 10 ? score : null,
  };
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
