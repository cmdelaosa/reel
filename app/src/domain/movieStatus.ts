/* Estado de una película — el equivalente de domain/status.ts para el cine.
   Puro, con tests al lado (movieStatus_test.ts).

   Una película es atómica: la ves o no la ves. Donde una serie tiene cinco
   estados, aquí hay tres, y no por simplificar sino porque los otros dos no
   pueden existir — "viéndola" y "al día" describen un progreso parcial que un
   único acto no tiene. Por eso tampoco hay "abandonada": una peli no se deja a
   medias (decisión de producto, 23-ago-2026).

   La aritmética la sirve la misma fila de rpc_library_rollup que las series,
   porque cada película mantiene un episodio sintético (migración 0067): emitido
   0 o 1 según haya llegado su fecha de estreno, visto 0 o 1. */

export type MovieStatus = "upcoming" | "watchlist" | "watched";

export interface MovieStatusInput {
  /** 1 cuando la fecha de estreno ya pasó, 0 mientras no. */
  airedCount: number;
  /** 1 cuando está marcada como vista. */
  watchedCount: number;
}

export function deriveMovieStatus({ airedCount, watchedCount }: MovieStatusInput): MovieStatus {
  // El visto manda sobre el estreno: se puede haber visto en un pase, en un
  // festival o en un vuelo antes de que TMDB dé por estrenada la película, y
  // decirle a alguien que aún no ha salido algo que acaba de marcar es
  // llamarle mentiroso.
  if (watchedCount > 0) return "watched";
  return airedCount === 0 ? "upcoming" : "watchlist";
}
