/* Qué forma tiene una fila según el medio de lo que describe. Puro, con tests
   al lado (mediumCopy.test.ts).

   Existe por una razón concreta: cada película y cada juego arrastran un
   episodio sintético S1E1 (migraciones 0067 y 0071) que está ahí para que
   "vista" / "terminado" tengan dónde escribirse, y que NO debe leerse nunca. El
   muro de amigos y el historial reciben ese episodio como cualquier otro, y la
   única cosa que impide que vuelvan a imprimir "S1 · E1" sobre una película o
   sobre un videojuego es esta decisión — así que vive fuera de los componentes,
   donde se puede probar, en vez de repartida en ternarios que nadie compara
   entre sí.

   Todas las funciones de aquí preguntan `kind === "tv"` en positivo, nunca
   `!== "movie"`. Es la misma regla que 0071 usa en SQL y por el mismo motivo:
   con el filtro positivo, el medio que llegue el año que viene hereda el
   comportamiento prudente sin que nadie se acuerde de esta línea. */

export type Medium = "tv" | "movie" | "game";

/** Cómo se cuenta un "hecho" en el muro. */
export type WatchedPhrase =
  /** "vio S1 · E3 de Severance" — una serie se ve por partes. */
  | "with-episodes"
  /** "vio Dune: Part Two" — una película se ve entera y de una vez. */
  | "whole-title"
  /** "terminó Silksong" — un juego no se ve: se termina. El evento por debajo
   *  es el MISMO watch_event que en cine (0073 lo dice: "me salieron los
   *  créditos"), pero llamarlo "vio" sería la etiqueta prestada que 0071 se
   *  negó a publicar. */
  | "whole-title-finished";

export const watchedPhrase = (kind: Medium): WatchedPhrase =>
  kind === "tv" ? "with-episodes" : kind === "game" ? "whole-title-finished" : "whole-title";

/** Cómo se llama la lista a la que se añade algo, que no es la misma en los tres
 *  medios: series y cine tienen "watchlist" y los juegos, "pendientes" — que es
 *  el nombre del cubo que ya existe en la biblioteca (Backlog). Decirle
 *  watchlist a una lista de juegos es decir "ver" de algo que se juega. */
export type AddedList = "watchlist" | "backlog";

export const addedList = (kind: Medium): AddedList =>
  kind === "game" ? "backlog" : "watchlist";

/** Si la fila puede decir "· N episodios" bajo el texto. Ni una película ni un
 *  juego tienen varios episodios que agrupar, así que el recuento nunca es suyo
 *  por mucho que el burst del RPC devuelva uno. */
export const showsEpisodeCount = (kind: Medium, count: number): boolean =>
  kind === "tv" && count > 1;

/** Qué va en las dos líneas de una fila del historial.
 *
 *  En una serie, el episodio manda: "S02 · E07" y debajo su título. En una
 *  película o en un juego el episodio no existe de cara a nadie, así que manda
 *  el título, y debajo el estudio — nunca el nombre del episodio sintético, que
 *  es una copia del título y repetirlo dos renglones seguidos no dice nada.
 *
 *  El "estudio" es la columna `network`, que cada medio llena con lo suyo: la
 *  cadena en series, la productora en cine y el desarrollador en juegos
 *  (igdb-proxy/normalize.ts, `studio`). */
export interface HistoryLines {
  /** La línea grande. */
  headline: "episode-number" | "title";
  /** La línea pequeña de debajo. */
  caption: "episode-name" | "studio";
}

export const historyLines = (kind: Medium): HistoryLines =>
  kind === "tv"
    ? { headline: "episode-number", caption: "episode-name" }
    : { headline: "title", caption: "studio" };
