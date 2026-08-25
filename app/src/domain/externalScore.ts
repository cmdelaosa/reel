/* La nota ajena de un título: la de IMDb cuando la hay, la de TMDB cuando no.
 *
 * POR QUÉ EXISTE, y por qué es una regla y no un `??` suelto donde toque.
 * En cine la nota de referencia es la de IMDb — es la que la gente cita y la
 * que se busca antes de ver una película. Pero no todas la tienen: una peli
 * recién estrenada, una rareza con cuatro votos o una que TMDB no vincula a
 * ningún tconst se quedan sin ella, y con "solo IMDb" esas carátulas saldrían
 * mudas. De ahí la reserva: nunca hay dos números compitiendo por el mismo
 * hueco, y nunca hay un hueco vacío pudiendo decir algo.
 *
 * Y por eso devuelve la FUENTE junto al número: enseñar un 7,4 de TMDB con el
 * amarillo de IMDb sería mentir en el único sitio donde la mentira no se ve —
 * quien lee la carátula no tiene forma de saber de dónde salió. El color y la
 * etiqueta salen de aquí, no del sitio que pinta.
 *
 * De momento la usa el cine (carátulas, rejillas de Explorar y la ficha). Las
 * series siguen enseñando la de TMDB en la carátula y las dos en la ficha: allí
 * la nota del conjunto pesa menos que la del episodio, que es la que la gráfica
 * de temporada ya cuenta con su propio detalle.
 */

export type ScoreSource = "imdb" | "tmdb";

export interface ExternalScore {
  value: number;
  source: ScoreSource;
}

/** Lo mínimo que hace falta para puntuar una fila, venga de `titles`, del
 *  rollup de la biblioteca o de una respuesta del proxy. */
export interface ScorableTitle {
  imdb_rating?: number | null;
  vote_average?: number | null;
}

/** Un número puntuable: finito y mayor que cero.
 *
 *  El cero no es una nota, es "nadie ha votado": TMDB devuelve `vote_average: 0`
 *  para cualquier estreno que aún no ha visto nadie, y pintarlo diría que la
 *  peli es un 0,0 — el peor número de la escala — cuando lo que pasa es que no
 *  hay dato. La carátula ya lo trataba así antes de existir esta regla
 *  (`voteAverage > 0`); aquí queda dicho una vez. */
const rated = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/** IMDb si la hay, TMDB si no, y null si ninguna de las dos dice nada. */
export function externalScore(t: ScorableTitle | null | undefined): ExternalScore | null {
  if (!t) return null;
  if (rated(t.imdb_rating)) return { value: t.imdb_rating, source: "imdb" };
  if (rated(t.vote_average)) return { value: t.vote_average, source: "tmdb" };
  return null;
}

/** El color de la estrella según de quién sea la nota. Los dos tokens ya
 *  existían: `--imdb` es el amarillo de su logotipo y `--accent` el de la app,
 *  que es con el que TMDB se ha pintado siempre. */
export const scoreColor = (source: ScoreSource): string =>
  source === "imdb" ? "var(--imdb)" : "var(--accent)";

/** La etiqueta de la celda en una ficha. Nombres propios: no se traducen. */
export const scoreLabel = (source: ScoreSource): string =>
  source === "imdb" ? "IMDb" : "TMDB";
