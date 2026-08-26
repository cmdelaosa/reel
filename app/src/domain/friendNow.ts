/* Lo que un amigo está haciendo AHORA, dicho en el medio en el que estás. Puro,
   con pruebas al lado (friendNow.test.ts).

   Reparte tres cosas que se decidían sueltas en dos pantallas:

     · el VERBO de la línea bajo su nombre en la lista de amigos, que decía
       siempre «Viendo» — hasta de un juego terminado (0084 lo cuenta entero);
     · a qué está jugando, que no sale de contar nada porque el progreso de un
       juego no está en ninguna tabla (domain/gameStatus);
     · en qué ORDEN se enseñan los bloques de su ficha, que es lo único que ahí
       mira el conmutador.

   Vive en domain y no en los componentes por lo de siempre: son reglas que hay
   que poder leer juntas y probar sin montar un router. */

import { deriveGameStatus, type PlayState } from "@/domain/gameStatus";
import { MEDIA, type Medium } from "@/domain/tasteScope";

/* ─────────────────────────── El verbo ───────────────────────────────────── */

/** Lo que un amigo está haciendo con lo último suyo de un medio. Lo decide el
 *  servidor (0084) y no el cliente: «viendo» y «acaba de ver» no los separa el
 *  modo sino un dato que solo está en la base —si a esa serie le queda algún
 *  episodio emitido sin ver—. */
export type FriendActivity = "watching" | "just-watched" | "playing" | "just-finished";

const ACTIVITIES: readonly string[] = ["watching", "just-watched", "playing", "just-finished"];

/* Tabla y no ternarios, como en domain/tasteScope: el estado que se añada
   mañana no compila hasta que diga con qué palabra se cuenta, en vez de heredar
   en silencio el verbo de las series.

   Prefijadas con `friends:` porque nombran un significado y no una palabra: el
   "Watching" sin prefijo ya es el cubo de Mis series, y el día que ese cubo se
   llame de otra forma esta línea no tiene por qué cambiar. */
const VERB: Record<FriendActivity, string> = {
  "watching": "friends: Watching",
  "just-watched": "friends: Just watched",
  "playing": "friends: Playing",
  "just-finished": "friends: Just finished",
};

/** La CLAVE del diccionario del verbo. Traducir es de la capa que pinta. */
export const friendActivityVerb = (activity: FriendActivity): string => VERB[activity];

/** El estado que trae el servidor, o el que corresponde al medio si no lo trae.
 *
 *  El respaldo es para el hueco entre aplicar 0084 y desplegar el frontend, en
 *  el que la columna no llega: es el mismo patrón que `addedListOf`
 *  (domain/mediumCopy) y por el mismo motivo. Y es un respaldo honesto, porque
 *  la función vieja solo sabía devolver lo último visto. */
export function friendActivityOf(fromServer: string | null | undefined, medium: Medium): FriendActivity {
  if (fromServer && ACTIVITIES.includes(fromServer)) return fromServer as FriendActivity;
  return medium === "game" ? "playing" : medium === "tv" ? "watching" : "just-watched";
}

/* ─────────────────────────── A qué juega ────────────────────────────────── */

/** La fila de biblioteca de un amigo, en lo que hace falta para saber si está
 *  jugando a esto. Todo opcional salvo el medio, el número y la fecha en que lo
 *  añadió: una base anterior a 0073 / 0075 / 0076 no trae ni estado, ni horas,
 *  ni `played_at`. */
export interface FriendGameRow {
  kind: Medium;
  tmdb_id: number;
  first_air_date?: string | null;
  play_state?: PlayState | null;
  minutes_played?: number | null;
  played_at?: string | null;
  owned?: boolean | null;
  added_at: string;
}

/** A qué está jugando, lo más reciente primero.
 *
 *  El estado sale de `deriveGameStatus` y no de mirar `play_state` a pelo, que
 *  es lo que evita la avería clásica de estas pantallas: un juego que él marcó
 *  «jugando» y luego se terminó se pinta terminado en su propia biblioteca, y
 *  aquí seguiría saliendo como que lo juega. Los créditos mandan.
 *
 *  'ongoing' entra con 'playing' porque también es jugarlo: lo que ese estado
 *  dice es que el juego no se acaba, no que lo haya dejado.
 *
 *  Ordena por `played_at` y cae a `added_at` cuando no consta, que es lo mismo
 *  que hace tu «Esta noche» de juegos (domain/gameTonight): la marca es de 0075
 *  y las filas de antes se quedaron en null a propósito. */
export function playingNow<T extends FriendGameRow>(
  rows: readonly T[],
  finishedIds: ReadonlySet<number>,
  now: Date = new Date(),
  limit = 12,
): T[] {
  const at = (r: T) => Date.parse(r.played_at ?? r.added_at) || 0;
  return rows
    .filter((r) => r.kind === "game")
    .filter((r) => {
      const released = r.first_air_date != null && Date.parse(r.first_air_date) <= now.getTime();
      const status = deriveGameStatus({
        airedCount: released ? 1 : 0,
        watchedCount: finishedIds.has(r.tmdb_id) ? 1 : 0,
        playState: r.play_state ?? null,
        owned: r.owned,
        minutesPlayed: r.minutes_played,
      });
      return status === "playing" || status === "ongoing";
    })
    .sort((a, b) => at(b) - at(a))
    .slice(0, limit);
}

/* ─────────────────────────── Lo último visto ────────────────────────────── */

export interface FriendWatchRow {
  kind: Medium;
  tmdb_id: number;
  watched_at: string;
}

/** Lo último que ha visto de un medio, sin repetir título.
 *
 *  Se de-duplica porque una serie son muchos eventos y una película uno solo:
 *  sin esto, un amigo que se metiera una temporada entera llenaría el bloque
 *  con la misma serie doce veces. Se queda el evento más reciente de cada
 *  título, que es el que fecha la fila. */
export function lastWatched<T extends FriendWatchRow>(
  rows: readonly T[],
  medium: Medium,
  limit = 6,
): T[] {
  const seen = new Set<number>();
  return [...rows]
    .filter((r) => r.kind === medium)
    .sort((a, b) => Date.parse(b.watched_at) - Date.parse(a.watched_at))
    .filter((r) => {
      if (seen.has(r.tmdb_id)) return false;
      seen.add(r.tmdb_id);
      return true;
    })
    .slice(0, limit);
}

/* ─────────────────────────── El orden ───────────────────────────────────── */

/** Los tres medios con el del conmutador delante.
 *
 *  Es TODO lo que la ficha de un amigo mira del modo, y merece decirse: la
 *  página enseña a la persona entera —esa decisión no cambia—, pero entrar en
 *  ella desde Videojuegos y encontrarse sus series lo primero era responder a
 *  otra pregunta. El resto conserva el orden de siempre (domain/tasteScope), no
 *  se reordena entre sí. */
export const mediaFirst = (current: Medium): Medium[] => [
  current,
  ...MEDIA.filter((m) => m !== current),
];
