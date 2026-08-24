// Tests del orden de búsqueda. Los corre el job `edge` de CI.
//
// Los tres casos grandes son respuestas REALES de IGDB del 24-ago-2026,
// recortadas a los campos que la regla mira. Están aquí porque cada uno es una
// avería que se vio en vivo, no una hipótesis: si mañana alguien "simplifica"
// el orden a lo que devuelve IGDB, estos tres vuelven a fallar y dicen por qué.
import { assertEquals } from "jsr:@std/assert@1";
import { GAME_TYPE_FILTER, mergeResults, normalizeName, popularityOf, rankSearch } from "./rank.ts";

const g = (name: string, hypes = 0, votes = 0) => ({
  name,
  hypes,
  total_rating_count: votes,
});
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

/* ── La propiedad que no se negocia ─────────────────────────────────────── */

Deno.test("reordenar no pierde ni inventa filas", () => {
  // La avería que tmdb-proxy tuvo en sus dos re-rankers: un bucle que se
  // quedaba corto y descartaba en silencio lo que sobraba de un lado. Aquí la
  // partición lo hace estructuralmente imposible, y aun así se comprueba.
  const rows = [g("A", 1), g("B"), g("C", 0, 9), g("D"), g("E", 5, 5)];
  const out = rankSearch(rows, "cualquier cosa");
  assertEquals(out.length, rows.length);
  assertEquals([...names(out)].sort(), ["A", "B", "C", "D", "E"]);
});

Deno.test("una búsqueda vacía no convierte todo en coincidencia exacta", () => {
  // normalizeName("") es "", y sin la guarda cualquier fila con nombre vacío
  // —o todas, si el término lo está— caería en el grupo de exactas.
  const rows = [g("Gris", 0, 576), g("", 0, 1)];
  assertEquals(names(rankSearch(rows, "")), ["Gris", ""]);
});

/* ── mergeResults ───────────────────────────────────────────────────────── */

Deno.test("unir las dos consultas no duplica ni pierde", () => {
  // El buscador hace dos consultas —una por nombre y otra por relevancia— y
  // se solapan mucho: "mario kart" devolvió 15 + 15 y solo 21 juegos
  // distintos. Sin deduplicar, la mitad de la lista salía dos veces.
  const a = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
  const b = [{ id: 2, name: "B" }, { id: 3, name: "C" }];
  assertEquals(mergeResults(a, b).map((r) => r.id), [1, 2, 3]);
});

Deno.test("manda la primera aparición y su orden", () => {
  // La consulta por nombre va ordenada por votos, así que llega primero y su
  // orden es el que se conserva antes de reordenar.
  const a = [{ id: 9, name: "de nombre" }];
  const b = [{ id: 9, name: "de relevancia" }];
  assertEquals(mergeResults(a, b), [{ id: 9, name: "de nombre" }]);
});

Deno.test("una fila sin id no cuela", () => {
  // Si IGDB devolviera algo sin id no se puede deduplicar, y colarlo
  // significaría poder repetirlo indefinidamente.
  assertEquals(mergeResults([{ name: "sin id" } as { id?: number }], []).length, 0);
});

/* ── Casos reales ───────────────────────────────────────────────────────── */

Deno.test('"hollow knight silksong": el de Team Cherry, no el fan game', () => {
  // IGDB devuelve primero un demake de Game Boy Color que se llama casi igual
  // y no tiene un solo voto. Los dos normalizan al mismo nombre —los dos
  // puntos se van—, así que los dos son "exactos" y quien decide es la
  // popularidad.
  const rows = [
    g("Hollow Knight Silksong"), //        el fan game: 0
    g("Hollow Knight: Silksong", 220, 503), // el real: 723
  ];
  assertEquals(names(rankSearch(rows, "hollow knight silksong")), [
    "Hollow Knight: Silksong",
    "Hollow Knight Silksong",
  ]);
});

Deno.test('"gta": GTA V por delante de Chinatown Wars', () => {
  // Ninguno coincide exactamente con "gta", así que manda la popularidad. El
  // orden de IGDB ponía Chinatown Wars (189) segundo y GTA V (5.916) octavo.
  const rows = [
    g("Grand Theft Auto: San Andreas", 0, 4035),
    g("Grand Theft Auto: Chinatown Wars", 0, 189),
    g("Prison Life Simulator 2022"),
    g("GTA: La Heist"),
    g("Grand Theft Auto: Vice City", 0, 3137),
    g("Grand Theft Auto VI", 982),
    g("Grand Theft Auto IV", 0, 1896),
    g("Grand Theft Auto V", 0, 5916),
  ];
  assertEquals(names(rankSearch(rows, "gta")).slice(0, 4), [
    "Grand Theft Auto V",
    "Grand Theft Auto: San Andreas",
    "Grand Theft Auto: Vice City",
    "Grand Theft Auto IV",
  ]);
});

Deno.test('"elden ring": el juego, y luego lo que se le parece', () => {
  const rows = [
    g("Elden Ring Nightreign", 0, 170),
    g("Elden Ring", 0, 2354),
    g("Elden Ring GB"),
    g("Elden Ring: Shadow of the Erdtree", 0, 194),
  ];
  assertEquals(names(rankSearch(rows, "elden ring")), [
    "Elden Ring", //                      coincidencia exacta
    "Elden Ring: Shadow of the Erdtree", // 194
    "Elden Ring Nightreign", //             170
    "Elden Ring GB", //                       0
  ]);
});

Deno.test('"zelda": una palabra suelta no es un título escrito entero', () => {
  // Hay un juego que se llama literalmente "Zelda" y no tiene un solo voto.
  // Con la coincidencia exacta a secas se ponía el primero, por delante de
  // Ocarina of Time. Una palabra sola es el nombre de una saga: no basta.
  const rows = [
    g("Zelda"),
    g("The Legend of Zelda: Ocarina of Time", 0, 2151),
    g("The Legend of Zelda", 0, 734),
  ];
  assertEquals(names(rankSearch(rows, "zelda")), [
    "The Legend of Zelda: Ocarina of Time",
    "The Legend of Zelda",
    "Zelda",
  ]);
});

Deno.test("una palabra suelta CON votos sí manda", () => {
  // "Gris" es una palabra y es exactamente el juego. Lo que descalifica a
  // "Zelda" no es ser corto, es no tener ninguna señal detrás.
  const rows = [g("Grisaia: Phantom Trigger", 0, 800), g("Gris", 0, 576)];
  assertEquals(names(rankSearch(rows, "gris"))[0], "Gris");
});

Deno.test("un juego diminuto buscado por su nombre entero gana a todo", () => {
  // "Un Pueblo de Nada" tiene cero votos y cero expectación. Sin el grupo de
  // coincidencias exactas, ordenar por popularidad lo enterraría bajo
  // cualquier cosa que comparta una palabra — y quien escribe el nombre
  // completo de un juego que casi nadie conoce sabe perfectamente qué busca.
  const rows = [
    g("Un Pueblo de Nada Grande", 0, 900),
    g("Un Pueblo de Nada"),
  ];
  assertEquals(names(rankSearch(rows, "un pueblo de nada"))[0], "Un Pueblo de Nada");
});

/* ── normalizeName ──────────────────────────────────────────────────────── */

Deno.test("la puntuación no impide una coincidencia exacta", () => {
  assertEquals(normalizeName("Papers, Please"), "papers please");
  assertEquals(normalizeName("Hollow Knight: Silksong"), "hollow knight silksong");
  assertEquals(normalizeName("  Gris  "), "gris");
});

Deno.test("los apóstrofos se borran, no se convierten en espacio", () => {
  // Con espacio saldría "marvel s spider man", que no lo teclea nadie.
  assertEquals(normalizeName("Marvel's Spider-Man"), "marvels spider man");
  assertEquals(normalizeName("Marvel’s Spider-Man"), "marvels spider man"); // apóstrofo tipográfico
});

Deno.test("los acentos no separan una palabra de sí misma", () => {
  assertEquals(normalizeName("Shénqí de Màozi"), "shenqi de maozi");
  assertEquals(normalizeName("Pokémon"), "pokemon");
});

/* ── popularityOf ───────────────────────────────────────────────────────── */

Deno.test("la popularidad suma expectación y votos", () => {
  // Un juego sin salir solo tiene hypes (GTA VI: 982); uno viejo solo votos.
  // La suma ordena las dos épocas en la misma lista.
  assertEquals(popularityOf({ hypes: 982 }), 982);
  assertEquals(popularityOf({ total_rating_count: 5916 }), 5916);
  assertEquals(popularityOf({ hypes: 220, total_rating_count: 503 }), 723);
  assertEquals(popularityOf({}), 0);
  assertEquals(popularityOf(null), 0);
});

/* ── El filtro de tipos ─────────────────────────────────────────────────── */

Deno.test("el filtro de tipos deja fuera lo que no se juega", () => {
  // Season (7) y Update (14) son las que llenaban "mario kart" y colaban un
  // parche en "hollow knight silksong". Bundle (3) y Mod (5), lo mismo.
  assertEquals(GAME_TYPE_FILTER, "(game_type = (0,1,2,4,8,9,10,11) | game_type = null)");
  for (const excluded of [3, 5, 6, 7, 12, 13, 14]) {
    assertEquals(
      GAME_TYPE_FILTER.includes(`,${excluded},`) || GAME_TYPE_FILTER.includes(`(${excluded},`),
      false,
      `el tipo ${excluded} no debería estar en el filtro`,
    );
  }
});
