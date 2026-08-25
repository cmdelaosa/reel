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
   *  la de TMDB queda de reserva para lo que IMDb no puntúa. Ausente en las
   *  carátulas que no la traen —series y juegos hoy—, que se pintan con la de
   *  TMDB exactamente como antes. */
  imdbRating?: number | null;
  /** Watch progress 0–100; the poster progress bar shows for 0 < progress < 100. */
  progress?: number;
  /** Stopped-watching flag; shows a pause badge on the poster. */
  stopped?: boolean;
}
