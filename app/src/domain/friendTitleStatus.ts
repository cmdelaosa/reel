/* En qué punto está un AMIGO con este título. Puro, con tests al lado
   (friendTitleStatus.test.ts).

   Tú tienes tu estado calculado en lib/library, sobre la fila que devuelve
   rpc_library_rollup. De un amigo no hay rollup —esa función es de quien
   llama— así que lo que llega es más pobre: su fila de `library_entries` (que
   la RLS de amigos deja leer desde 0015) y si tiene marcado el episodio
   sintético de la película o del juego (0067, 0071).

   Este módulo hace con esos dos datos lo mismo que la biblioteca hace con la
   fila gorda, y por eso NO reimplementa nada: llama a deriveMovieStatus y a
   deriveGameStatus, los mismos de tu biblioteca. Es lo que evita la avería
   clásica de estas pantallas — que la ficha diga de tu amigo "pendiente" de un
   juego que su propia biblioteca le pinta como "lo tengo".

   ── Por qué solo cine y juegos ────────────────────────────────────────────
   Una serie no cabe aquí. Su estado sale de contar episodios emitidos contra
   vistos, y contar los de un amigo es una consulta por amigo (rpc_friend_
   progress, que es de UN amigo) — no una lectura barata dentro de una ficha
   que ya hace cuatro. En cine y en juegos el "visto" es UN episodio sintético,
   así que la cuenta es una sola consulta para todos los amigos a la vez.

   ── Por qué el estado puede ser null ──────────────────────────────────────
   Un amigo puede haber PUNTUADO algo que no sigue —así llega una importación
   de FilmAffinity o de Steam de lo que ya no tiene— y entonces no hay estado
   que contar, solo una nota. Null es eso: "no tiene fila, o su fila no dice
   nada". Quien pinta enseña la nota sola, sin inventarle un "pendiente". */

import { deriveGameStatus, type GameStatus, type PlayState } from "@/domain/gameStatus";
import { deriveMovieStatus, type MovieStatus } from "@/domain/movieStatus";

/** La fila de biblioteca de un amigo, en lo que este módulo necesita. Todo
 *  opcional salvo `followed`: una base anterior a 0076/0078 no trae `owned` ni
 *  `play_state`, y un null ahí no es un error sino "no ha dicho nada". */
export interface FriendEntry {
  followed: boolean;
  owned?: boolean | null;
  playState?: PlayState | null;
  minutesPlayed?: number | null;
}

export interface FriendTitleInput {
  /** Su fila de `library_entries`, o null si no sigue el título. */
  entry: FriendEntry | null;
  /** Tiene marcado el episodio sintético: la ha visto / se lo ha terminado. */
  finished: boolean;
  /** El título ya salió. Se pregunta al TÍTULO y no a la fila, por lo mismo
   *  que en la ficha del juego: el `aired_count` del rollup no existe aquí. */
  released: boolean;
}

/** El estado de un amigo con una PELÍCULA, o null si no hay nada que decir. */
export function friendMovieStatus({ entry, finished, released }: FriendTitleInput): MovieStatus | null {
  // Vista manda sobre seguida: marcarla vista sin tenerla en la lista —lo que
  // hace una importación— sigue siendo un estado, y de los buenos.
  if (!finished && !entry?.followed) return null;
  return deriveMovieStatus({ airedCount: released ? 1 : 0, watchedCount: finished ? 1 : 0 });
}

/** El estado de un amigo con un JUEGO, o null si no hay nada que decir. */
export function friendGameStatus({ entry, finished, released }: FriendTitleInput): GameStatus | null {
  if (!finished && !entry?.followed) return null;
  return deriveGameStatus({
    airedCount: released ? 1 : 0,
    watchedCount: finished ? 1 : 0,
    playState: entry?.playState ?? null,
    owned: Boolean(entry?.owned),
    minutesPlayed: entry?.minutesPlayed ?? 0,
  });
}

/* Las palabras. Devuelve CLAVES del diccionario y no texto, como el resto de
   domain/: traducir es de la capa que pinta.

   Son las del cubo de cada biblioteca —las mismas que ya lee la persona en Mis
   pelis y en Mis juegos— salvo dos, que son de esta pantalla:

     · 'watchlist' de cine dice "Sin empezar" en la biblioteca, que hablando de
       OTRO no se entiende ("¿sin empezar qué?"). Aquí es "La tiene pendiente".
     · 'owned' no tiene cubo propio en juegos (gameStatus.ts explica por qué),
       así que su palabra nace aquí.

   En tercera persona y no en participio suelto: la fila dice lo que hace tu
   amigo, no en qué cajón está guardado. */
const MOVIE_LABEL: Record<MovieStatus, string> = {
  upcoming: "friend: Not out yet",
  watchlist: "friend: On their watchlist",
  watched: "friend: Watched it",
};

const GAME_LABEL: Record<GameStatus, string> = {
  upcoming: "friend: Not out yet",
  backlog: "friend: In their backlog",
  owned: "friend: Owns it",
  playing: "friend: Playing it",
  ongoing: "friend: Keeps playing it",
  finished: "friend: Finished it",
  dropped: "friend: Dropped it",
};

export const friendMovieLabel = (status: MovieStatus): string => MOVIE_LABEL[status];
export const friendGameLabel = (status: GameStatus): string => GAME_LABEL[status];
