// Tests de las reglas de la importación. Los corre el job `edge` de CI.
import { assertEquals } from "jsr:@std/assert@1";
import { isConflict, minutesToWrite, parseOwnedGames } from "./merge.ts";

/* ── El perfil privado, que es el fallo silencioso ───────────────────────── */

Deno.test("perfil privado: 200 con response vacío, y NO es 'no tienes juegos'", () => {
  // Este es el caso que hay que distinguir a toda costa. Steam no devuelve
  // error: devuelve 200 y `{"response":{}}`. Leerlo como una biblioteca vacía
  // deja a la persona buscando un fallo que no existe en su cuenta.
  assertEquals(parseOwnedGames({ response: {} }), { kind: "private" });
  assertEquals(parseOwnedGames({}), { kind: "private" });
  assertEquals(parseOwnedGames(null), { kind: "private" });
});

Deno.test("perfil público sin juegos: eso sí es una biblioteca vacía", () => {
  // La diferencia observable es `game_count`, que el perfil cerrado no manda.
  assertEquals(parseOwnedGames({ response: { game_count: 0, games: [] } }), {
    kind: "ok",
    games: [],
  });
});

Deno.test("lee appid, nombre y minutos tal cual llegan", () => {
  const r = parseOwnedGames({
    response: {
      game_count: 2,
      games: [
        { appid: 570, name: "Dota 2", playtime_forever: 1234 },
        { appid: 730, name: "Counter-Strike 2", playtime_forever: 0 },
      ],
    },
  });
  // MINUTOS: es la unidad de Steam y la de library_entries.minutes_played. No
  // hay conversión en ningún punto de esta rama.
  assertEquals(r, {
    kind: "ok",
    games: [
      { appid: 570, name: "Dota 2", minutes: 1234 },
      { appid: 730, name: "Counter-Strike 2", minutes: 0 },
    ],
  });
});

Deno.test("una fila rota no tira la lista entera", () => {
  const r = parseOwnedGames({
    response: {
      game_count: 4,
      games: [
        { appid: 570, name: "Dota 2", playtime_forever: 60 },
        { appid: "no", name: "Basura", playtime_forever: 10 },
        { name: "Sin appid", playtime_forever: 10 },
        // Sin `include_appinfo=1` Steam manda solo el appid. El respaldo evita
        // que un juego retirado de la tienda deje la fila sin nada que leer.
        { appid: 999, playtime_forever: -5 },
      ],
    },
  });
  assertEquals(r, {
    kind: "ok",
    games: [
      { appid: 570, name: "Dota 2", minutes: 60 },
      { appid: 999, name: "App 999", minutes: 0 },
    ],
  });
});

/* ── Lo escrito a mano ───────────────────────────────────────────────────── */

const manual = (minutes: number) => ({ minutes, source: "manual" });
const deSteam = (minutes: number) => ({ minutes, source: "steam" });

Deno.test("40 h tuyas de consola contra 12 h de Steam: es un conflicto", () => {
  assertEquals(isConflict(manual(2400), 720), true);
  // Y sin la casilla marcada, no se toca. Esta es toda la razón de ser de
  // minutes_source (0073).
  assertEquals(minutesToWrite(manual(2400), 720, false), null);
  assertEquals(minutesToWrite(manual(2400), 720, true), 720);
});

Deno.test("lo que ya venía de Steam se reescribe sin preguntar", () => {
  // Si no, volver a sincronizar no serviría para nada: cada fila importada se
  // volvería un conflicto permanente consigo misma.
  assertEquals(isConflict(deSteam(600), 720), false);
  assertEquals(minutesToWrite(deSteam(600), 720, false), 720);
});

Deno.test("sin horas que perder no hay conflicto", () => {
  assertEquals(isConflict(manual(0), 720), false);
  assertEquals(isConflict(null, 720), false);
  assertEquals(minutesToWrite(manual(0), 720, false), 720);
  assertEquals(minutesToWrite(null, 720, false), 720);
});

Deno.test("cifras iguales: se escribe igual, y eso cambia el origen", () => {
  // No es un desperdicio. Lo que cambia es minutes_source, que pasa a 'steam':
  // dejarla en 'manual' por casualidad convertiría esa fila en un conflicto
  // para siempre.
  assertEquals(isConflict(manual(720), 720), false);
  assertEquals(minutesToWrite(manual(720), 720, false), 720);
});
