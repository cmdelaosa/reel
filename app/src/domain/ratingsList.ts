/* Tus notas puestas en lista: en qué orden se leen, cuántas hay de cada medio y
   con qué palabras se encabeza la lista de cada uno. Puro, con pruebas al lado
   (ratingsList.test.ts).

   Vive en domain y no dentro de la pantalla porque lo que hay aquí lo usan DOS
   sitios que tienen que decir lo mismo: las tres tarjetas del perfil, que
   prometen "1.005 puntuadas · media 7,4", y la pantalla de notas de ese medio,
   que tiene que enseñar exactamente esas 1.005. Con la cuenta en un sitio y el
   filtro en el otro, la tarjeta y la lista se separan el día que alguien toque
   uno de los dos.

   El `Medium` viene de tasteScope, que además trae el ORDEN de los tres medios:
   series, cine y juegos, el mismo que el conmutador de la barra y los bloques
   de gustos. */

import { MEDIA, type Medium } from "@/domain/tasteScope";

/* ──────────────────────────────── El orden ──────────────────────────────── */

export type RateSort = "new" | "old" | "best" | "worst";

/** Los cuatro órdenes con su rótulo, en el orden en que se ofrecen. Claves del
 *  diccionario y no texto: traducir es de la capa que pinta. */
export const RATE_SORTS: readonly { readonly key: RateSort; readonly label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "old", label: "Oldest" },
  { key: "best", label: "Best rated" },
  { key: "worst", label: "Worst rated" },
];

/** Lo mínimo que hace falta saber de una nota para ordenarla. Deliberadamente
 *  menos que `RatedRow` (lib/ratings): así esto se prueba con objetos de dos
 *  campos y no arrastra el título entero con su póster y sus géneros. */
export interface RatingLike {
  readonly score: number;
  readonly created_at: string;
}

/* Las fechas llegan en ISO con zona Z, así que comparar las cadenas es comparar
   los instantes — sin construir mil y pico Date en cada pasada. */
const byNew = (a: RatingLike, b: RatingLike): number => b.created_at.localeCompare(a.created_at);

/** Una copia ordenada. Copia y no en el sitio: las filas vienen de la caché de
 *  react-query, que las comparte con la afinidad, las estadísticas y el muro —
 *  ordenar el array original le cambia el orden a los tres por la espalda.
 *
 *  Los empates los rompe el orden en el que llegan, que ya es total: la consulta
 *  pide `created_at desc, title_id` (lib/ratings) y `Array.sort` es estable. Sin
 *  esa segunda columna, las notas de una importación —cientos con el mismo
 *  instante— cambiarían de sitio entre una página y la siguiente. */
export function sortRatings<T extends RatingLike>(rows: readonly T[], sort: RateSort): T[] {
  const cmp: Record<RateSort, (a: T, b: T) => number> = {
    new: byNew,
    old: (a, b) => byNew(b, a),
    best: (a, b) => b.score - a.score || byNew(a, b),
    worst: (a, b) => a.score - b.score || byNew(a, b),
  };
  return [...rows].sort(cmp[sort]);
}

/* ───────────────────────────── Cuántas y de qué ─────────────────────────── */

export interface MediumRatings {
  readonly count: number;
  /** La media de ese medio, o null si no hay ni una nota — que no es lo mismo
   *  que un 0, y pintarlo como "0,0" diría que puntúas fatal el cine que aún no
   *  has puntuado. */
  readonly avg: number | null;
}

/** Cuántas notas tienes de cada medio y con qué media. Los tres siempre, aunque
 *  alguno esté a cero: quien pinta decide si esconde los vacíos, y así esta
 *  función no tiene que adivinarlo. */
export function ratingsSummary(
  rows: readonly { readonly score: number; readonly kind: Medium }[],
): Record<Medium, MediumRatings> {
  const total = new Map<Medium, { n: number; sum: number }>(MEDIA.map((m) => [m, { n: 0, sum: 0 }]));
  for (const row of rows) {
    const acc = total.get(row.kind);
    if (!acc) continue; // un `kind` desconocido no infla la media de nadie
    acc.n += 1;
    acc.sum += row.score;
  }
  return Object.fromEntries(
    MEDIA.map((m) => {
      const { n, sum } = total.get(m)!;
      return [m, { count: n, avg: n > 0 ? sum / n : null }];
    }),
  ) as Record<Medium, MediumRatings>;
}

/* ─────────────────────────────── Las palabras ───────────────────────────── */

/* Tres frases y no una con el nombre del medio interpolado, por lo mismo que
   mediumCopy y tasteScope: en español el género arrastra, y "812 juegos
   puntuadas" no lo arregla ningún `{medium}`. Y en tabla, para que el medio que
   llegue el año que viene no compile hasta que alguien escriba las suyas. */

const TITLE: Record<Medium, string> = {
  tv: "Your show ratings",
  movie: "Your movie ratings",
  game: "Your game ratings",
};

/** El encabezado de la pantalla de notas de un medio. */
export const ratingsTitle = (medium: Medium): string => TITLE[medium];

/* Seis frases: singular y plural de cada medio, como el desglose del día de la
   rejilla de actividad (domain/mediumCopy, `watchedCountKey`). No sobra ninguna:
   la primera vez que abres esto tienes una nota, y "1 series puntuadas" es lo
   que se lee en la tarjeta de quien acaba de empezar. */
const SUMMARY: Record<Medium, { one: string; many: string }> = {
  tv: { one: "{n} show rated · avg {avg}", many: "{n} shows rated · avg {avg}" },
  movie: { one: "{n} movie rated · avg {avg}", many: "{n} movies rated · avg {avg}" },
  game: { one: "{n} game rated · avg {avg}", many: "{n} games rated · avg {avg}" },
};

/** El renglón pequeño de la tarjeta del perfil: cuántas y la media. Lleva los
 *  dos huecos dentro de la frase porque la traducción decide dónde van. */
export const ratingsSummaryLine = (medium: Medium, count: number): string =>
  count === 1 ? SUMMARY[medium].one : SUMMARY[medium].many;

const EMPTY: Record<Medium, string> = {
  tv: "No show ratings yet — open a show and tap the stars.",
  movie: "No movie ratings yet — open a movie and tap the stars.",
  game: "No game ratings yet — open a game and tap the stars.",
};

/** El vacío de la pantalla de un medio, que dice qué abrir para llenarlo. */
export const ratingsEmpty = (medium: Medium): string => EMPTY[medium];

/* ──────────────────────────────── El sitio ──────────────────────────────── */

/* ⚠️ Estas tres rutas están escritas también en main.tsx, y nada ata las dos
   tablas. Se tocan juntas: el router no tiene ruta comodín, así que renombrar
   una ruta en un solo sitio no da error — deja la pantalla en blanco bajo la
   barra, que es lo que ya pasó con la biblioteca de juegos (mismo aviso en
   domain/mediumRoute).

   Las palabras son las de las rutas de la app —shows, movies, games— y no las
   claves del medio (`tv`), para que estas URLs se lean como las otras. */
const ROUTE: Record<Medium, string> = {
  tv: "/you/ratings/shows",
  movie: "/you/ratings/movies",
  game: "/you/ratings/games",
};

/** La pantalla con tus notas de ese medio. */
export const ratingsRoute = (medium: Medium): string => ROUTE[medium];
