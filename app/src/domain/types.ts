/** View-model for a show rendered as a poster card (grids, rails, search).
 *  Built by feature code from DB rows; UI components consume only this. */
export interface TitleCard {
  id: string;
  name: string;
  year: string;
  genres: string[];
  /** Full image URL when TMDB art exists; the gradient fallback renders otherwise. */
  posterPath?: string;
  /** TMDB community score, 0–10. Hidden when 0. */
  voteAverage: number;
  /** Nota de IMDb, 0–10, cuando la fila la tiene. Manda sobre `voteAverage` en
   *  la insignia de la carátula (domain/externalScore): en cine es LA nota, y
   *  la de TMDB queda de reserva para lo que IMDb no puntúa. Las series la
   *  llevan igual desde que la biblioteca y Continuar la traen. Ausente en los
   *  juegos, que se pintan con su nota de IGDB. */
  imdbRating?: number | null;
  /** Las reseñas de Steam de un juego (0086), cuando la fila las trae. Es LA
   *  nota de un juego —la que se mira antes de comprarlo— y por eso la carátula
   *  la enseña junto a la de IGDB en vez de en su lugar: son dos públicos
   *  distintos (una redacción y un catálogo frente a quien se lo ha jugado), y
   *  tapar una con otra sería elegir por quien mira. Ausente en series y en
   *  cine, y también en los juegos que no se venden en Steam. */
  steamReviews?: { percent: number; count: number } | null;
  /** Watch progress 0–100; the poster progress bar shows for 0 < progress < 100. */
  progress?: number;
  /** Stopped-watching flag; shows a pause badge on the poster. */
  stopped?: boolean;
}
