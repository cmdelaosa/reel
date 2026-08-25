// Tests de las reglas de la importación. Los corre el job `edge` de CI.
import { assertEquals } from "jsr:@std/assert@1";
import { finishedAt, isConflict, lastPlayedOf, minutesToWrite, parseOwnedGames, parsePick } from "./merge.ts";

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
        { appid: 570, name: "Dota 2", playtime_forever: 1234, rtime_last_played: 1755000000 },
        { appid: 730, name: "Counter-Strike 2", playtime_forever: 0, rtime_last_played: 0 },
      ],
    },
  });
  // MINUTOS: es la unidad de Steam y la de library_entries.minutes_played. No
  // hay conversión en ningún punto de esta rama.
  assertEquals(r, {
    kind: "ok",
    games: [
      { appid: 570, name: "Dota 2", minutes: 1234, lastPlayed: "2025-08-12T12:00:00.000Z" },
      // rtime_last_played = 0 es "nunca", no el 1 de enero de 1970.
      { appid: 730, name: "Counter-Strike 2", minutes: 0, lastPlayed: null },
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
      { appid: 570, name: "Dota 2", minutes: 60, lastPlayed: null },
      { appid: 999, name: "App 999", minutes: 0, lastPlayed: null },
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

/* ── La última partida, que es la fecha del "terminado" (0078) ───────────── */

const AHORA = Date.parse("2026-08-25T10:00:00.000Z");

Deno.test("rtime_last_played son SEGUNDOS unix", () => {
  assertEquals(lastPlayedOf(1755000000, AHORA), "2025-08-12T12:00:00.000Z");
});

Deno.test("0, basura y el futuro no son fechas", () => {
  // El 0 lo trae todo lo que nunca has abierto. Pasarlo tal cual fecharía un
  // juego terminado en 1970 y lo colaría el primero en el historial.
  assertEquals(lastPlayedOf(0, AHORA), null);
  assertEquals(lastPlayedOf(undefined, AHORA), null);
  assertEquals(lastPlayedOf("ayer", AHORA), null);
  assertEquals(lastPlayedOf(-5, AHORA), null);
  // Un reloj que va mal no puede meter un evento donde ninguna lista lo enseña.
  assertEquals(lastPlayedOf(Math.round(AHORA / 1000) + 90000, AHORA), null);
});

Deno.test("terminado se fecha con tu última partida, no con hoy", () => {
  const hoy = new Date(AHORA);
  assertEquals(finishedAt("2024-03-12T21:05:00.000Z", hoy), "2024-03-12T21:05:00.000Z");
  // Y solo cuando no la hay cae a hoy: un juego con 0 h que marcas terminado a
  // mano lo estás terminando ahora.
  assertEquals(finishedAt(null, hoy), "2026-08-25T10:00:00.000Z");
});

/* ── Lo que manda la pantalla de confirmar ───────────────────────────────── */

Deno.test("terminado viaja aparte de play_state", () => {
  // Porque no es una etiqueta: es el watch_event (0073). Si fuera un
  // play_state habría dos formas de decir lo mismo.
  const p = parsePick({ id: "a", state: "finished", rating: 9 });
  assertEquals(p, { id: "a", overwrite: false, playState: null, finished: true, rating: 9 });
});

Deno.test("un estado inventado se queda en 'no ha dicho nada'", () => {
  // Llega del navegador. Un play_state que la comprobación de la tabla rechaza
  // tiraría la importación entera por una fila.
  assertEquals(parsePick({ id: "a", state: "terminadísimo" })?.playState, null);
  assertEquals(parsePick({ id: "a", state: "backlog" })?.playState, "backlog");
  assertEquals(parsePick({ id: "a" })?.playState, null);
  assertEquals(parsePick({ state: "playing" }), null);
});

Deno.test("la nota es un entero de 1 a 10 o no es nada", () => {
  assertEquals(parsePick({ id: "a", rating: 10 })?.rating, 10);
  assertEquals(parsePick({ id: "a", rating: 0 })?.rating, null);
  assertEquals(parsePick({ id: "a", rating: 11 })?.rating, null);
  assertEquals(parsePick({ id: "a", rating: 7.5 })?.rating, null);
  assertEquals(parsePick({ id: "a", rating: "9" })?.rating, null);
});
