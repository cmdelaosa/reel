/* Central TanStack Query keys — every key in the app lives here (ARCHITECTURE
   → Data-access conventions). */

export const qk = {
  profile: (userId: string) => ["profile", userId] as const,
  invited: (userId: string) => ["invited", userId] as const,
  search: (q: string) => ["search", q] as const,
  /* Claves propias del cine, no variantes de las de series: un id de TMDB solo
     es único dentro de su medio (0067), así que ["title", 1399] y
     ["movie", 1399] son cosas distintas y compartir prefijo las mezclaría. */
  movieSearch: (q: string) => ["movieSearch", q] as const,
  movie: (tmdbId: number) => ["movie", tmdbId] as const,
  movieCredits: (tmdbId: number) => ["movieCredits", tmdbId] as const,
  movieSaga: (tmdbId: number) => ["movieSaga", tmdbId] as const,
  /* Y las de juegos, por el mismo motivo elevado a tres: el id de un juego es
     de IGDB, otro espacio de numeración entero (0071). */
  gameSearch: (q: string) => ["gameSearch", q] as const,
  game: (igdbId: number) => ["game", igdbId] as const,
  gamePool: (pool: string) => ["gamePool", pool] as const,
  /* Steam (0076). Dos claves y no una: la cuenta enlazada cambia una vez cada
     mucho y el borrador de la importación se sondea cada dos segundos mientras
     hay trabajo — compartir clave sería refrescar el perfil cuarenta veces por
     importación. */
  steamLink: ["steamLink"] as const,
  steamImport: ["steamImport"] as const,
  /* El inventario del mercado (0088). Una sola clave para lo que tienes, los
     precios, el libro y la serie: se leen juntos porque se pintan juntos, y
     separarlos solo daría cuatro estados de carga en una pantalla que no puede
     enseñar un total a medias. */
  steamInventory: ["steamInventory"] as const,
  /* La serie reconstruida (0092) va aparte del inventario, y no por capricho:
     es una llamada a una función que suma cuarenta mil velas en la base, y
     colgarla de `steamInventory` la volvería a pedir cada vez que se sube un
     volcado o se refresca cualquier otra cosa de la pantalla. */
  steamValueSeries: ["steamValueSeries"] as const,
  /* El histórico de UN objeto, que solo se pide cuando abres su ficha. Con el
     nombre dentro de la clave para que abrir dos fichas seguidas no se pisen. */
  steamItemHistory: (appid: number, name: string) => ["steamItemHistory", appid, name] as const,
  title: (tmdbId: number) => ["title", tmdbId] as const,
  season: (tmdbId: number, n: number) => ["season", tmdbId, n] as const,
  detailProgress: (titleId: string) => ["detailProgress", titleId] as const,
  library: ["library"] as const,
  watched: (titleId: string) => ["watched", titleId] as const,
  /* Cuándo viste UN episodio (0088). Clave propia y no una parte de `watched`:
     esa se invalida entera al marcar cualquier episodio de la serie, y esto
     solo cambia para el episodio que se acaba de tocar. */
  watchedAt: (episodeId: string) => ["watched-at", episodeId] as const,
  myRating: (titleId: string) => ["myRating", titleId] as const,
  upNext: ["upNext"] as const,
  calendarFeed: (fromIso: string, toIso: string) => ["calendarFeed", fromIso, toIso] as const,
  history: ["history"] as const,
  ratings: ["ratings"] as const,
  /* Cuándo puntuaste cada título, sin el título colgando — lo que necesitan las
     tres bibliotecas para ordenar por «última puntuada» (domain/ratedSort).
     Cuelga de `ratings` A PROPÓSITO: TanStack invalida por prefijo, así que
     todo lo que ya invalida qk.ratings al escribir una nota —puntuar desde una
     ficha, la importación de Steam— tira también de esta sin acordarse de ella.
     Una clave hermana habría que ir añadiéndola a mano en cada escritor, y la
     que se olvidara dejaría la rejilla ordenada por notas de ayer. */
  ratedAt: ["ratings", "ratedAt"] as const,
  stats: ["stats"] as const,
  watchHeatmap: ["watchHeatmap"] as const,
  notifications: ["notifications"] as const,
  friendActivity: (limit: number) => ["friendActivity", limit] as const,
  /* El detalle de una fila plegada del muro (0077). Por clave de evento, que
     es lo que identifica esa fila en todo lo demás — las reacciones ya viajan
     por ella. */
  addedBatch: (eventKey: string) => ["addedBatch", eventKey] as const,
  /* The whole key list, sorted — the cache key has to BE the query's input.
     Keyed by a digest of it (the newest event + the count) instead, two pages
     that shared a head and a length served each other's reactions, and a row
     appearing mid-feed was never fetched at all. `reactions` is the prefix the
     optimistic writer and the realtime handler broadcast over. */
  reactions: ["eventReactions"] as const,
  eventReactions: (keys: string[]) => ["eventReactions", [...keys].sort()] as const,
  ignored: ["ignored"] as const,
  networkLogos: ["networkLogos"] as const,
  providers: (region: string, kind: "tv" | "movie", tmdbId: number) =>
    ["providers", region, kind, tmdbId] as const,
};
