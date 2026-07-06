/** View-model for a show rendered as a poster card (grids, rails, search).
 *  Built by feature code from DB rows; UI components consume only this. */
export interface TitleCard {
  id: string;
  name: string;
  year: string;
  genres: string[];
  network: string;
  /** Full image URL when TMDB art exists; the gradient fallback renders otherwise. */
  posterPath?: string;
  /** TMDB community score, 0–10. Hidden when 0. */
  voteAverage: number;
  /** Watch progress 0–100; the poster progress bar shows for 0 < progress < 100. */
  progress?: number;
}
