/* Estado de un videojuego — el equivalente de domain/status.ts y de
   domain/movieStatus.ts para el tercer medio. Puro, con tests al lado.

   Una serie tiene cinco estados y una película tres, y en los dos casos salen
   de la aritmética: episodios emitidos contra episodios vistos. Un juego no.
   "Lo estoy jugando" y "lo dejé" no se pueden contar, porque el progreso de un
   juego no está en ninguna tabla — está en tu cabeza, o en una partida guardada
   que Reel no ve. Así que aquí hay dos fuentes, no una:

     - `watchedCount`, la aritmética de siempre: el episodio sintético (0071)
       marcado es "me salieron los créditos".
     - `playState`, lo que la persona ha dicho a mano.

   Y una asimetría deliberada: TERMINADO no es un playState. Es el mismo
   watch_event que usan series y cine, y por eso un juego terminado entra en el
   historial, en el muro y en las notas sin que nada de eso sepa que existen los
   videojuegos — igual que pasó con las películas en 0067. Si "terminado" fuera
   un playState habría dos formas de decir lo mismo y algún día dirían cosas
   distintas.

   ── El quinto estado: 'ongoing' ──────────────────────────────────────────
   Counter-Strike, el LoL o un PUBG no se acaban. No es que no los hayas
   acabado: es que no tienen créditos, y ofrecerte un botón de "Terminado" en su
   ficha sería ofrecerte algo imposible.

   Se modela como ESTADO y no como propiedad del juego, que era la otra opción.
   IGDB no marca en ningún sitio "esto no acaba" —lo más cerca es que le falten
   los tiempos de `game_time_to_beats`, y deducirlo de un dato ausente es
   frágil—, así que de un modo u otro acabas marcándolo a mano. Como estado
   responde justo lo que pregunta el cubo, y deja libre "Abandonado" para el día
   que dejes el CS: dejarlo es una cosa y que sea infinito es otra.

   Lo que arrastra: un juego 'ongoing' no ofrece Terminado y no pinta
   denominador. Sus horas se enseñan a secas, porque no hay contra qué medirlas
   (ver hoursProgress). */

export type GameStatus = "upcoming" | "backlog" | "playing" | "ongoing" | "finished" | "dropped";

/** Lo que la persona puede fijar a mano. "Terminado" no está: es el
 *  watch_event, no una etiqueta. "Pendiente" y "Próximo" tampoco: se derivan de
 *  no haber dicho nada, igual que la watchlist de una película. */
export type PlayState = "playing" | "ongoing" | "dropped";

export interface GameStatusInput {
  /** 1 cuando la fecha de lanzamiento ya pasó, 0 mientras no. */
  airedCount: number;
  /** 1 cuando está marcado como terminado. */
  watchedCount: number;
  /** Lo que la persona dijo, si dijo algo. */
  playState: PlayState | null | undefined;
}

export function deriveGameStatus({
  airedCount,
  watchedCount,
  playState,
}: GameStatusInput): GameStatus {
  // Terminado manda sobre todo lo demás, como "visto" en el cine: se puede
  // terminar un juego en acceso anticipado, en una beta o en una copia que
  // salió antes de tiempo, y decirle a alguien que aún no ha salido algo que
  // acaba de terminarse es llamarle mentiroso.
  if (watchedCount > 0) return "finished";

  // Lo dicho a mano manda sobre la fecha por el mismo motivo: si estás jugando
  // a algo que IGDB da por no lanzado, estás jugando.
  if (playState) return playState;

  return airedCount === 0 ? "upcoming" : "backlog";
}

/** Los tres cubos que admiten horas por delante. Un 'upcoming' no puede
 *  tenerlas y un 'backlog' deja de serlo en cuanto las tiene. */
export const PLAYABLE: readonly GameStatus[] = ["playing", "ongoing", "finished", "dropped"];

/** Cuánto llevas de lo que dura, en 0-100, contra la media de IGDB.
 *
 *  Devuelve null —no 0— cuando no hay denominador honesto, y ese null es la
 *  señal de "enseña las horas a secas, sin barra":
 *
 *    - 'ongoing': no hay final contra el que medir. Un CS con 400 horas no está
 *      al 400% de nada.
 *    - sin tiempos de IGDB: los juegos pequeños no los tienen, y una barra
 *      inventada sobre un denominador que no existe es peor que ninguna barra.
 *
 *  Se mide contra `normally` (terminarlo con algo de contenido secundario) y no
 *  contra `hastily` ni `completely`: es la que describe cómo juega la mayoría, y
 *  la única de las tres que no obliga a explicar cuál es. Pasar del 100% está
 *  permitido a propósito y no se recorta — si le has echado el doble de lo que
 *  dice la media, la barra llena y el número diciendo la verdad es la lectura
 *  correcta. */
export function hoursProgress(
  minutesPlayed: number,
  beatSeconds: { normally?: number | null } | null | undefined,
  status: GameStatus,
): number | null {
  if (status === "ongoing") return null;
  const normally = beatSeconds?.normally;
  if (typeof normally !== "number" || normally <= 0) return null;
  if (minutesPlayed <= 0) return 0;
  return Math.round((minutesPlayed * 60 / normally) * 100);
}

/** "18 h", "45 min", "2 h 30 min". Para el número que va al lado de la barra.
 *
 *  Por debajo de una hora se enseñan minutos: una tarde suelta con un juego
 *  pequeño es "40 min", y redondearlo a "1 h" o a "0 h" miente en las dos
 *  direcciones. A partir de diez horas se dejan de enseñar los minutos, que ya
 *  no le importan a nadie y solo hacen la cifra más larga. */
export function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "0 h";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 10 || rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}
