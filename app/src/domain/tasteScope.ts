/* El alcance del taste match: QUÉ notas se comparan y CÓMO se abre lo que sale
   de la comparación. Puro, con pruebas al lado (tasteScope.test.ts).

   Existe por una avería concreta. La afinidad cruzaba las notas por `tmdb_id` a
   secas, y desde 0067 (cine) y 0071 (juegos) ese número solo es único DENTRO de
   su medio: la película 1399 y la serie 1399 son cosas distintas, y el id de
   IGDB de un juego vive en otro espacio de numeración entero. Comparar las tres
   listas en el mismo saco es inventar coincidencias entre una serie tuya y la
   película —o el juego— que lleve ese número en casa de un amigo.

   La decisión, que es de producto y no de tipos: hay TRES afinidades, una por
   modo. La de series se calcula con series, la de cine con películas y la de
   juegos con juegos. Por eso el filtro vive aquí, en el borde de la lectura, y
   no repartido por los `Map` de cada página — filtrando antes, la clave vuelve
   a ser el `tmdb_id` a secas sin que eso sea una trampa.

   Se declara `Medium` aquí, como en domain/mediumCopy: este módulo es puro y
   sus pruebas corren sin DOM, mientras que lib/medium escribe `data-medium` en
   <html> al importarse. */

export type Medium = "tv" | "movie" | "game";

/** Las filas de UN medio, sean tuyas o de un amigo.
 *
 *  Pregunta `kind === medium` en positivo, la misma regla que 0071 usa en SQL:
 *  el medio que llegue el año que viene no se cuela en la afinidad de otro por
 *  un `!==` que nadie se acordó de tocar. */
export const ofMedium = <T extends { kind: Medium }>(rows: readonly T[], medium: Medium): T[] =>
  rows.filter((row) => row.kind === medium);

/** El parámetro de URL que abre la ficha de un título según su medio.
 *
 *  Son tres y no uno por lo que explica Shell.tsx: un id solo es único dentro
 *  de su medio, así que `?title=` sobre una película abre la serie que lleve
 *  ese número, o nada. Cada fila de estas páginas —que ya no son solo de
 *  series— tiene que decir en qué espacio de numeración vive su id. */
export type SheetParam = "title" | "movie" | "game";

export const sheetParam = (kind: Medium): SheetParam =>
  kind === "movie" ? "movie" : kind === "game" ? "game" : "title";

/* ─────────────────────────── Las palabras ───────────────────────────────── */

/** Las CLAVES del diccionario que cambian con el medio en las pantallas de
 *  gustos. Devuelve claves y no texto por lo mismo que mediumCopy: traducir es
 *  de la capa que pinta.
 *
 *  No es floritura: en español el género arrastra. "Puntuadas en común" vale
 *  para series y películas y es falso para juegos, y "la puntuó" dicho de un
 *  juego habla de otra cosa. Interpolar el nombre del medio en una sola frase
 *  no arregla eso, así que son tres frases. */
export interface TasteCopy {
  /** Vacío: no has puntuado nada de este medio. */
  rateFirst: string;
  /** Ningún amigo ha puntuado nada que tú hayas puntuado. */
  noShared: string;
  /** El pie que explica de dónde sale el porcentaje. */
  basedOn: string;
  /** "N puntuadas en común", bajo el nombre del amigo. */
  ratedInCommon: string;
  /** "{amigo} la puntuó". */
  ratedIt: string;
  /** "N amigos la puntuaron". */
  friendsRatedIt: string;
  /** "1 amigo la puntuó". */
  friendRatedIt: string;
  /** El vacío de "Tus notas contra las suyas". */
  noOverlap: string;
  /** "N series en común" — lo que los dos seguís, en la ficha de un amigo. */
  inCommon: string;
}

const TV: TasteCopy = {
  rateFirst: "Rate a few shows first — your taste match is built from the shows you and your friends both scored.",
  noShared: "None of your friends rated a show you rated — yet. Nudge them to score something.",
  basedOn: "Based on the shows you both rated — the more you share, the more the score trusts it.",
  ratedInCommon: "rated in common",
  ratedIt: "rated it",
  friendsRatedIt: "friends rated it",
  friendRatedIt: "friend rated it",
  noOverlap: "No overlap yet — rate a few shows your friends also scored.",
  inCommon: "shows in common",
};

const MOVIE: TasteCopy = {
  rateFirst: "Rate a few movies first — your taste match is built from the movies you and your friends both scored.",
  noShared: "None of your friends rated a movie you rated — yet. Nudge them to score something.",
  basedOn: "Based on the movies you both rated — the more you share, the more the score trusts it.",
  ratedInCommon: "movies rated in common",
  ratedIt: "rated the movie",
  friendsRatedIt: "friends rated the movie",
  friendRatedIt: "friend rated the movie",
  noOverlap: "No overlap yet — rate a few movies your friends also scored.",
  inCommon: "movies in common",
};

const GAME: TasteCopy = {
  rateFirst: "Rate a few games first — your taste match is built from the games you and your friends both scored.",
  noShared: "None of your friends rated a game you rated — yet. Nudge them to score something.",
  basedOn: "Based on the games you both rated — the more you share, the more the score trusts it.",
  ratedInCommon: "games rated in common",
  ratedIt: "rated the game",
  friendsRatedIt: "friends rated the game",
  friendRatedIt: "friend rated the game",
  noOverlap: "No overlap yet — rate a few games your friends also scored.",
  inCommon: "games in common",
};

export const tasteCopy = (medium: Medium): TasteCopy =>
  medium === "movie" ? MOVIE : medium === "game" ? GAME : TV;
