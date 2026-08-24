// discover.ts — las consultas de las rejillas de Explorar, y solo eso.
//
// Vive fuera de index.ts por lo mismo que rank.ts y normalize.ts: index.ts
// llama a Deno.serve al importarse, así que nada de lo que hay allí se puede
// probar. Aquí no se hacen peticiones; se escriben las consultas.
//
// ── Por qué son cuatro y por qué estas cuatro ─────────────────────────────
// Son las gemelas de las de tmdb-proxy, traducidas a lo que un catálogo de
// juegos sabe responder:
//
//   anticipated  ← "tendencias". En series, lo que la gente ve esta semana; en
//                  juegos, lo que la gente ESPERA. IGDB publica `hypes`, que es
//                  cuánta gente sigue un juego sin salir, y es la única señal
//                  que existe antes del lanzamiento.
//   new          ← "en cartelera". Lo que acaba de salir.
//   popular      ← igual que allí: lo más votado.
//   top-rated    ← igual que allí: la nota más alta, con suelo de votos.
//
// ── El suelo de votos de "mejor valorados" no es un detalle ───────────────
// Sin él, la lista es un muestrario de juegos con UN voto de 100/100: IGDB
// calcula `total_rating` con los votos que haya, y con uno solo el resultado es
// ese voto. Es el fallo clásico de cualquier ranking por media, y el suelo es
// la única defensa. Va en el WHERE y no al recibir por el mismo motivo por el
// que el filtro de tipos de rank.ts va allí: filtrando después, el `limit` ya
// se gastó en las filas que se iban a tirar.
//
// ── Segundos, no milisegundos ─────────────────────────────────────────────
// `first_release_date` es un unix timestamp EN SEGUNDOS. Pasarle Date.now(),
// que son milisegundos, no da un error: da una ventana que empieza dentro de
// cincuenta mil años, y la rejilla sale vacía sin una sola queja en el log.
// Por eso las funciones de aquí toman `nowMs` y dividen ellas, y por eso hay
// una prueba que lo comprueba.

import { GAME_TYPE_FILTER } from "./rank.ts";

/** Las cuatro rejillas caducan a las 24 h, igual que las de tmdb-proxy. Con
 *  4 req/s compartidas entre TODOS los usuarios, aquí la caché no es una
 *  optimización: es el motivo de que Explorar se pueda abrir. */
export const DISCOVER_TTL_MS = 24 * 3600 * 1000;

/** Cuánto hacia atrás llega "Novedades". Cuatro meses y no uno: un juego no se
 *  juega el día que sale — sale, lo compras cuando baja de precio, lo empiezas
 *  el finde siguiente— y una ventana de treinta días deja la pestaña casi vacía
 *  en los meses flojos del calendario. */
export const NEW_WINDOW_DAYS = 120;

/** Votos mínimos para entrar en "Mejor valorados". Cien es alto a propósito:
 *  con veinte, la lista se llenaba de juegos de nicho con una media perfecta
 *  hecha por sus veinte fans. */
export const TOP_RATED_MIN_VOTES = 100;

/** Y para "Populares", que ordena POR número de votos y por tanto no necesita
 *  protegerse de la media — el suelo aquí solo sirve para que la consulta no
 *  tenga que ordenar el catálogo entero. */
export const POPULAR_MIN_VOTES = 50;

/** Votos mínimos de una novedad. Bajo, porque un juego de hace tres semanas no
 *  ha tenido tiempo de acumular votos; lo justo para dejar fuera el aluvión de
 *  publicaciones sin nadie detrás, que en un catálogo de juegos es la mayoría
 *  de lo que sale cada semana. */
export const NEW_MIN_VOTES = 5;

/** Cuántas filas trae cada rejilla. */
export const DISCOVER_LIMIT = 60;

const secs = (ms: number) => Math.floor(ms / 1000);

/* Lo común a las cuatro: no son ediciones (`version_parent = null`, que si no
   la rejilla sale con la Deluxe, la GOTY y la de aniversario del mismo juego) y
   son cosas que alguien juega y apunta (GAME_TYPE_FILTER deja fuera Season,
   Update, Bundle y Mod). Los dos son exactamente los de /search, y a propósito:
   una lista de juegos es una lista de juegos se llegue por donde se llegue. */
const BASE = `version_parent = null & ${GAME_TYPE_FILTER}`;

/** Lo más esperado: juegos sin salir, por expectativa.
 *
 *  `hypes > 0` deja fuera la larguísima cola de anuncios que no sigue nadie —
 *  sin él, los que empatan a cero salen en el orden que le apetezca a IGDB. */
export function anticipatedQuery(fields: string, nowMs: number): string {
  return `fields ${fields}; where first_release_date > ${secs(nowMs)} & hypes > 0 & ${BASE}; ` +
    `sort hypes desc; limit ${DISCOVER_LIMIT};`;
}

/** Recién salidos, del más reciente al más viejo.
 *
 *  La ventana se acota por ARRIBA además de por abajo, y no es redundante: sin
 *  el tope, un juego con fecha de 2031 metida por error en el catálogo —los
 *  hay— encabeza "Novedades" para siempre. */
export function newReleasesQuery(fields: string, nowMs: number): string {
  const since = secs(nowMs - NEW_WINDOW_DAYS * 24 * 3600 * 1000);
  return `fields ${fields}; where first_release_date >= ${since} & ` +
    `first_release_date <= ${secs(nowMs)} & total_rating_count >= ${NEW_MIN_VOTES} & ${BASE}; ` +
    `sort first_release_date desc; limit ${DISCOVER_LIMIT};`;
}

/** Los más votados. "Popular" en un catálogo de juegos es cuánta gente lo ha
 *  jugado lo bastante como para puntuarlo, que es la definición que IGDB puede
 *  sostener con sus datos. */
export function popularQuery(fields: string): string {
  return `fields ${fields}; where total_rating_count >= ${POPULAR_MIN_VOTES} & ${BASE}; ` +
    `sort total_rating_count desc; limit ${DISCOVER_LIMIT};`;
}

/** La nota más alta entre los que tienen votos suficientes para que la nota
 *  signifique algo. */
export function topRatedQuery(fields: string): string {
  return `fields ${fields}; where total_rating_count >= ${TOP_RATED_MIN_VOTES} & ` +
    `total_rating != null & ${BASE}; sort total_rating desc; limit ${DISCOVER_LIMIT};`;
}
