// Lo que comparten las dos importaciones. Aquí solo se prueba lo que es una
// DECISIÓN — fundir dos filas que caen en el mismo juego —; el resto de este
// módulo son escrituras contra la base, que se prueban con la base.
import { assertEquals } from "jsr:@std/assert@1";
import { mergeByTitle } from "./game-import.ts";

const T = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

Deno.test("dos filas del mismo juego salen como una", () => {
  /* Sin esto, las dos viajan en el mismo upsert y Postgres tira el lote entero
     con «ON CONFLICT DO UPDATE command cannot affect row a second time»: una
     importación de veinte juegos falla del todo porque dos se llamaban igual.
     Con Nintendo el emparejamiento es por NOMBRE, así que la de Switch y la de
     Switch 2 del mismo juego caen las dos en la misma fila de `titles`. */
  const merged = mergeByTitle([
    { titleId: T, minutes: 720, playState: null },
    { titleId: T, minutes: 1800, playState: null },
  ]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].titleId, T);
});

Deno.test("de los minutos gana el mayor, y NO se suman", () => {
  // Sumar daría el doble en el caso más probable: la misma partida listada dos
  // veces. La cifra mayor es la que no es un fragmento.
  const merged = mergeByTitle([
    { titleId: T, minutes: 720, playState: null },
    { titleId: T, minutes: 1800, playState: null },
  ]);
  assertEquals(merged[0].minutes, 1800);
});

Deno.test("un null en cualquiera de las dos manda: esas horas no se tocan", () => {
  // Null es "las escribió a mano y no se pisan". Dejar que la otra fila las
  // pisara sería saltarse la única regla que estas importaciones prometen.
  assertEquals(
    mergeByTitle([
      { titleId: T, minutes: null, playState: null },
      { titleId: T, minutes: 1800, playState: null },
    ])[0].minutes,
    null,
  );
  assertEquals(
    mergeByTitle([
      { titleId: T, minutes: 1800, playState: null },
      { titleId: T, minutes: null, playState: null },
    ])[0].minutes,
    null,
  );
});

Deno.test("del estado y la fecha gana el primero que diga algo", () => {
  const merged = mergeByTitle([
    { titleId: T, minutes: 10, playState: null, playedAt: null },
    { titleId: T, minutes: 20, playState: "playing", playedAt: "2026-08-25T18:00:00.000Z" },
  ]);
  assertEquals(merged[0].playState, "playing");
  assertEquals(merged[0].playedAt, "2026-08-25T18:00:00.000Z");
});

Deno.test("lo que no se repite se queda tal cual, y en su orden", () => {
  const merged = mergeByTitle([
    { titleId: T, minutes: 10, playState: "backlog" },
    { titleId: OTHER, minutes: 20, playState: null },
  ]);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].titleId, T);
  assertEquals(merged[0].playState, "backlog");
  assertEquals(merged[1].titleId, OTHER);
  assertEquals(merged[1].minutes, 20);
});

Deno.test("una lista vacía no es un caso especial", () => {
  assertEquals(mergeByTitle([]), []);
});
