/* Qué forma tiene una fila según el medio de lo que describe. Puro, con tests
   al lado (mediumCopy.test.ts).

   Existe por una razón concreta: cada película arrastra un episodio sintético
   S1E1 (migración 0067) que está ahí para que "vista" tenga dónde escribirse, y
   que NO debe leerse nunca. El muro de amigos y el historial reciben ese
   episodio como cualquier otro, y la única cosa que impide que vuelvan a
   imprimir "S1 · E1" sobre una película es esta decisión — así que vive fuera
   de los componentes, donde se puede probar, en vez de repartida en ternarios
   que nadie compara entre sí. */

export type Medium = "tv" | "movie";

/** Cómo se cuenta un "visto" en el muro. */
export type WatchedPhrase =
  /** "vio S1 · E3 de Severance" — una serie se ve por partes. */
  | "with-episodes"
  /** "vio Dune: Part Two" — una película se ve entera y de una vez. */
  | "whole-title";

export const watchedPhrase = (kind: Medium): WatchedPhrase =>
  kind === "movie" ? "whole-title" : "with-episodes";

/** Si la fila puede decir "· N episodios" bajo el texto. Una película no tiene
 *  varios episodios que agrupar, así que el recuento nunca es suyo por mucho
 *  que el burst del RPC devuelva uno. */
export const showsEpisodeCount = (kind: Medium, count: number): boolean =>
  kind !== "movie" && count > 1;

/** Qué va en las dos líneas de una fila del historial.
 *
 *  En una serie, el episodio manda: "S02 · E07" y debajo su título. En una
 *  película el episodio no existe de cara a nadie, así que manda ella: su
 *  título, y debajo el estudio — nunca el nombre del episodio sintético, que es
 *  una copia del título y repetirlo dos renglones seguidos no dice nada. */
export interface HistoryLines {
  /** La línea grande. */
  headline: "episode-number" | "title";
  /** La línea pequeña de debajo. */
  caption: "episode-name" | "studio";
}

export const historyLines = (kind: Medium): HistoryLines =>
  kind === "movie"
    ? { headline: "title", caption: "studio" }
    : { headline: "episode-number", caption: "episode-name" };
