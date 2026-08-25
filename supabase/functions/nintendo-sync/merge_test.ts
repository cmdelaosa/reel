// Las reglas de la importación de Nintendo. Cada prueba es una decisión de
// 0080, no una comprobación de que TypeScript sabe sumar.
import { assertEquals } from "jsr:@std/assert@1";
import {
  externalIdOf,
  normalizeFriendCode,
  normalizeName,
  parsePlayLog,
  playedAtFor,
} from "./merge.ts";

/* ── El código de amigo ─────────────────────────────────────────────────── */

Deno.test("el código se acepta como lo enseña la consola y como lo copia la gente", () => {
  for (
    const raw of [
      "SW-1839-0856-9768",
      "sw-1839-0856-9768",
      "1839-0856-9768",
      "1839 0856 9768",
      "  183908569768  ",
      "SW 1839 0856 9768",
    ]
  ) {
    assertEquals(normalizeFriendCode(raw), "SW-1839-0856-9768", raw);
  }
});

Deno.test("lo que no son doce dígitos no es un código, y no se adivina", () => {
  for (const raw of ["", "123", "SW-1839-0856-976", "1839085697689", "hola", null, 183908569768]) {
    assertEquals(normalizeFriendCode(raw), null, String(raw));
  }
});

/* ── La llave de cada juego ─────────────────────────────────────────────── */

Deno.test("el nsuid de la URL de la tienda es la llave cuando lo hay", () => {
  assertEquals(
    externalIdOf({ shopUri: "https://ec.nintendo.com/apps/70010000012345/ES", name: "Split Fiction" }),
    "70010000012345",
  );
});

Deno.test("sin URL de tienda, la llave es el nombre normalizado y va marcada como tal", () => {
  // El prefijo `name:` impide que un juego llamado "70010000012345" pudiera
  // colisionar con el nsuid de otro.
  assertEquals(externalIdOf({ name: "Súper Mario Odyssey™" }), "name:super mario odyssey");
  assertEquals(externalIdOf({ name: "70010000012345" }), "name:70010000012345");
});

Deno.test("normalizar quita acentos, marcas y espacios de más", () => {
  assertEquals(normalizeName("  Pokémon™   Legends:  Z-A "), "pokemon legends: z-a");
});

/* ── El registro de juego ───────────────────────────────────────────────── */

Deno.test("lee nombre, minutos y carátula tal cual llegan", () => {
  const games = parsePlayLog([
    {
      name: "Split Fiction",
      imageUri: "https://m.example/700ejb6.png",
      shopUri: "https://ec.nintendo.com/apps/70010000012345/ES",
      totalPlayTime: 142,
      firstPlayedAt: 0,
    },
  ]);
  assertEquals(games, [{
    externalId: "70010000012345",
    name: "Split Fiction",
    // MINUTOS, que es la unidad de totalPlayTime y la de
    // library_entries.minutes_played. No hay conversión en ningún punto.
    minutes: 142,
    imageUri: "https://m.example/700ejb6.png",
  }]);
});

Deno.test("una fila rota no tira la lista entera", () => {
  const games = parsePlayLog([
    { name: null, totalPlayTime: 10 },
    { name: "   ", totalPlayTime: 10 },
    { name: "Mario Kart World", totalPlayTime: "no", imageUri: 7 },
  ]);
  assertEquals(games.length, 1);
  assertEquals(games[0].name, "Mario Kart World");
  assertEquals(games[0].minutes, 0);
  assertEquals(games[0].imageUri, null);
});

Deno.test("dos entradas con la misma llave son una: gana la primera, que es la reciente", () => {
  const games = parsePlayLog([
    { name: "Tetris 99", totalPlayTime: 90 },
    { name: "Tetris 99", totalPlayTime: 12 },
  ]);
  assertEquals(games.length, 1);
  assertEquals(games[0].minutes, 90);
});

Deno.test("lo que no es una lista es una lista vacía, no una excepción", () => {
  assertEquals(parsePlayLog(null), []);
  assertEquals(parsePlayLog({ result: [] }), []);
});

/* ── La última partida, aprendida ───────────────────────────────────────── */

Deno.test("la primera importación no sabe cuándo jugaste, y no se lo inventa", () => {
  // Poner hoy dejaría veinte juegos empatados arriba en "Esta noche".
  assertEquals(playedAtFor(null, 249 * 60), null);
  assertEquals(playedAtFor(undefined, 30), null);
});

Deno.test("minutos que suben son una partida, y la fecha es ahora", () => {
  const now = new Date("2026-08-25T18:00:00.000Z");
  assertEquals(playedAtFor(120, 145, now), "2026-08-25T18:00:00.000Z");
});

Deno.test("minutos iguales no son una partida: refrescar no reordena nada", () => {
  assertEquals(playedAtFor(120, 120, new Date()), null);
});

Deno.test("minutos que bajan tampoco: eso es haber borrado el registro", () => {
  assertEquals(playedAtFor(120, 12, new Date()), null);
});
