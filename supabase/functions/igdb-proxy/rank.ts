// rank.ts — qué entra en una búsqueda de juegos y en qué orden.
//
// Hermano de tmdb-proxy/rank.ts y por el mismo motivo: son reglas puras sobre
// listas, se equivocan de formas sutiles, y la única manera de saber que hacen
// lo que dicen es probarlas con datos reales. Los casos de rank_test.ts están
// copiados de respuestas de verdad de IGDB (24-ago-2026), no inventados.
//
// ── El problema, con nombres propios ──────────────────────────────────────
// `search` de IGDB es relevancia textual y nada más. Medido sobre ocho
// términos, produce esto:
//
//   "mario kart"  → los OCHO primeros son eventos de Mario Kart Tour, tipo
//                   Season. Ni un solo juego de Mario Kart en la página.
//   "hollow knight silksong" → primero un fan game de Game Boy Color con cero
//                   votos; el de Team Cherry, con 723, segundo.
//   "gta"         → Chinatown Wars (189) por delante de GTA V (5.916).
//
// Son dos averías distintas y se arreglan en dos sitios distintos.
//
// ── 1. Qué es un juego, a efectos de una biblioteca ───────────────────────
// IGDB clasifica en quince tipos y algunos no son cosas que nadie "juegue y
// apunte": un Season de un juego-servicio es un evento de temporada, un Update
// es un parche, un Bundle es una forma de comprar dos juegos. Filtrarlos en el
// WHERE y no aquí es la mitad importante del arreglo: quitarlos DESPUÉS de
// recibir deja "mario kart" con cero resultados, porque el límite ya se gastó
// en ellos. Filtrando antes, los mismos ocho huecos traen ocho juegos.
export const SEARCHABLE_GAME_TYPES = [
  0, // Main Game
  1, // DLC
  2, // Expansion
  4, // Standalone Expansion  — "Un Pueblo de Nada" es esto, y es un juego
  8, // Remake
  9, // Remaster
  10, // Expanded Game
  11, // Port
] as const;

// Fuera quedan: 3 Bundle, 5 Mod, 6 Episode, 7 Season, 12 Fork, 13 Pack/Addon,
// 14 Update.
//
// El `| game_type = null` del filtro es un seguro: un juego sin clasificar no
// tiene por qué desaparecer del buscador. Sobre los ocho términos medidos no
// cambió ni un resultado, y cuesta nada.
export const GAME_TYPE_FILTER =
  `(game_type = (${SEARCHABLE_GAME_TYPES.join(",")}) | game_type = null)`;

/* ── 2. El orden ───────────────────────────────────────────────────────────
 *
 * Dos grupos, cada uno ordenado por popularidad, y el orden textual de IGDB se
 * descarta. Suena agresivo y es lo que los datos piden: dentro de los que
 * coinciden con lo que escribiste, IGDB ordena de una forma que no sigue
 * ninguna señal que el usuario pueda percibir.
 *
 *   1. Los que se llaman EXACTAMENTE lo que buscaste (normalizando).
 *   2. Todos los demás.
 *
 * El primer grupo existe por los juegos pequeños: "Un Pueblo de Nada" tiene
 * cero votos y cero expectación, y ordenar solo por popularidad lo enterraría
 * bajo cualquier cosa. Si escribes su nombre entero, es lo que quieres, y no
 * hay señal más fuerte que esa.
 *
 * Pero "exacto" a secas resultó ser demasiado: buscar "zelda" ponía primero un
 * juego que se llama literalmente "Zelda" y no tiene ni un voto, por delante
 * de Ocarina of Time con 2.151. Una palabra suelta no es un título que alguien
 * haya escrito entero, es el nombre de una saga. De ahí las dos condiciones de
 * `isExact`: una coincidencia exacta manda si tiene ALGO de popularidad, o si
 * lo que escribiste son dos palabras o más. Cero señal y una sola palabra es
 * una casualidad del catálogo, no lo que buscabas.
 *
 * Dentro de cada grupo, popularidad descendente. Eso pone GTA V por delante de
 * Chinatown Wars, Mario Kart 8 por delante de Arcade GP, y —en el grupo
 * exacto— el Silksong de Team Cherry por delante del fan game que se llama
 * igual.
 *
 * Ninguna fila se pierde: es una partición y dos ordenaciones. Es la misma
 * propiedad que vigila tmdb-proxy/rank_test.ts, y por la misma razón (allí un
 * re-ranker descartaba filas en silencio). */

/** El nombre reducido a lo comparable: sin mayúsculas, sin acentos, sin
 *  puntuación y sin espacios de más.
 *
 *  Los apóstrofos se BORRAN en vez de convertirse en espacio, que es la
 *  diferencia entre que "marvels spider man" encuentre a "Marvel's Spider-Man"
 *  y que no lo encuentre. El resto de la puntuación sí pasa a espacio: es lo
 *  que hace que "Papers, Please" y "papers please" sean lo mismo, y que el
 *  "Hollow Knight: Silksong" con dos puntos empate con el fan game que se
 *  llama igual sin ellos — empate que luego rompe la popularidad. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // las marcas de acento que NFD separa
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** La popularidad de un juego en una sola cifra.
 *
 *  `hypes` es la gente que lo sigue ANTES de salir y es lo único que hay para
 *  un juego sin lanzar (GTA VI: 982, todo expectación); `total_rating_count`
 *  son los votos, que es lo único que hay para uno viejo. Sumarlos da una
 *  columna que ordena las dos épocas sin ramas — la misma definición que
 *  `gameRow.popularity` escribe en `titles`, a propósito: una sola idea de
 *  "popular" en toda la función. */
// deno-lint-ignore no-explicit-any
export function popularityOf(g: any): number {
  return (g?.hypes ?? 0) + (g?.total_rating_count ?? 0);
}

/** Reordena los resultados de una búsqueda. No filtra: eso ya lo hizo el
 *  WHERE. No pierde filas. */
export function rankSearch<T>(rows: readonly T[], term: string): T[] {
  const wanted = normalizeName(term);
  const deliberate = wanted.split(" ").filter(Boolean).length >= 2;

  // deno-lint-ignore no-explicit-any
  const isExact = (r: any) =>
    wanted.length > 0 &&
    normalizeName(String(r?.name ?? "")) === wanted &&
    (deliberate || popularityOf(r) > 0);

  const byPopularity = (a: T, b: T) => popularityOf(b) - popularityOf(a);

  return [
    ...rows.filter(isExact).sort(byPopularity),
    ...rows.filter((r) => !isExact(r)).sort(byPopularity),
  ];
}
