/* La matriz de la importación de InfiniteBacklog.
 *
 *   npm test        (en este directorio; es `node --import tsx --test`)
 *
 * Lo que se prueba es lo que decide, no lo que escribe: el CSV mal partido, la
 * tabla de estados, las fechas y la fusión con lo que ya hay en la cuenta. La
 * red y PostgREST viven en index.ts y no se prueban aquí — lo que puede salir
 * mal ahí lo dice el propio informe de la ejecución.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPlan,
  decideEntry,
  isoOf,
  minutesOf,
  parseCsv,
  progressOf,
  ratingOf,
  type CurrentEntry,
  type PlannedGame,
} from "./lib.ts";

/* ─────────────────────────── El CSV ────────────────────────────────────── */

test("parseCsv: una coma dentro de comillas no parte el campo", () => {
  const rows = parseCsv('IGDB ID,Game name\n144554,"If on a Winter\'s Night, Four Travelers"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Game name"], "If on a Winter's Night, Four Travelers");
  assert.equal(rows[0]["IGDB ID"], "144554");
});

test("parseCsv: comillas escapadas, CRLF y BOM", () => {
  const rows = parseCsv('﻿a,b\r\n1,"di ""hola"""\r\n');
  assert.deepEqual(rows, [{ a: "1", b: 'di "hola"' }]);
});

test("parseCsv: un export de solo cabecera no inventa filas", () => {
  assert.deepEqual(parseCsv("IGDB ID,Game name\n"), []);
});

/* ─────────────────────── La tabla de estados ───────────────────────────── */

const MATRIZ: Array<[string, string, string | null, boolean]> = [
  // Status,    Completion,     play_state esperado, terminado
  ["Played",    "Completed",    null,       true],
  ["Played",    "Beaten",       null,       true],
  ["",          "Completed",    null,       true],
  ["Played",    "Continuous",   "ongoing",  false],
  ["Played",    "Dropped",      "dropped",  false],
  ["",          "Dropped",      "dropped",  false],
  ["Playing",   "Unfinished",   "playing",  false],
  ["Played",    "Unfinished",   null,       false],
  ["",          "Unfinished",   null,       false],
  ["",          "Not Started",  null,       false],
  ["",          "No Status",    null,       false],
  ["Played",    "",             null,       false],
];

for (const [status, completion, playState, finished] of MATRIZ) {
  test(`progressOf(${status || "—"}, ${completion || "—"})`, () => {
    assert.deepEqual(progressOf(status, completion), { playState, finished });
  });
}

test("progressOf: 'Jugando' solo sale de Status=Playing, nunca de las horas", () => {
  // La avería que esto tapa: 'Playing' derivado de "tiene horas" mete en Jugando
  // los 254 juegos que alguna vez tocaste. Es la regla 1 de steam-sync/merge.ts.
  assert.equal(progressOf("Played", "Unfinished").playState, null);
});

/* ─────────────────────── Minutos, notas y fechas ───────────────────────── */

test("minutesOf", () => {
  assert.equal(minutesOf("97100"), 97100);
  assert.equal(minutesOf(""), 0);
  assert.equal(minutesOf("0"), 0);
  assert.equal(minutesOf("no"), 0);
  assert.equal(minutesOf("-5"), 0);
});

test("ratingOf: el 0 de InfiniteBacklog es 'sin nota', no una nota baja", () => {
  assert.equal(ratingOf("0"), null);       // score tiene check between 1 and 10
  assert.equal(ratingOf(""), null);
  assert.equal(ratingOf("7"), 7);
  assert.equal(ratingOf("10"), 10);
  assert.equal(ratingOf("11"), null);
  assert.equal(ratingOf("7.5"), null);
});

test("isoOf: vacío y futuro son null", () => {
  assert.equal(isoOf("2024-12-21T14:12:07.000Z"), "2024-12-21T14:12:07.000Z");
  assert.equal(isoOf(""), null);
  assert.equal(isoOf("cuando sea"), null);
  assert.equal(isoOf("2030-01-01T00:00:00.000Z", Date.parse("2026-08-25T00:00:00Z")), null);
});

/* ──────────────────────────── El plan ──────────────────────────────────── */

const COL = [
  "IGDB ID,Game name,Platform,Status,Completion,Ownership,Playtime,Rating (Score),Date added,Last updated",
  '20,"BioShock",Windows PC,Played,Completed,Owned,1022,6,2024-12-21T14:12:07.000Z,2024-12-21T14:12:07.000Z',
  '1011,"Borderlands 2",Windows PC,Played,Unfinished,Owned,939,,2024-12-21T14:12:07.000Z,2025-01-02T00:00:00.000Z',
  '222095,"Super Mario Bros.",,,Completed,,,,2025-01-02T18:50:46.000Z,2025-01-02T18:50:46.000Z',
  "",
].join("\n");

const LISTAS = [
  "List ID,List title,IGDB ID,Game name,Game release date,Notes",
  '15418,"Want to play",1942,"The Witcher 3: Wild Hunt",2015-05-19,""',
  '15418,"Want to play",1011,"Borderlands 2",2012-09-18,""',
  "",
].join("\n");

test("buildPlan: la colección manda sobre las listas", () => {
  const { games } = buildPlan(COL, LISTAS, "IGDB ID,Game name\n");
  assert.equal(games.length, 4);   // 3 de colección + 1 de lista, sin duplicar el 1011

  const borderlands = games.find((g) => g.igdbId === 1011)!;
  assert.equal(borderlands.from, "collection");
  assert.equal(borderlands.minutes, 939);
  assert.equal(borderlands.playState, null);   // NO 'backlog' por estar en la lista

  const witcher = games.find((g) => g.igdbId === 1942)!;
  assert.equal(witcher.from, "list");
  assert.equal(witcher.playState, "backlog");  // explícito: estar en la lista es decirlo
  assert.equal(witcher.owned, false);
});

test("buildPlan: lo terminado se fecha con Last updated, no con hoy", () => {
  const { games } = buildPlan(COL, LISTAS, "");
  const bioshock = games.find((g) => g.igdbId === 20)!;
  assert.equal(bioshock.finished, true);
  assert.equal(bioshock.finishedAt, "2024-12-21T14:12:07.000Z");
  assert.equal(bioshock.rating, 6);
  assert.equal(bioshock.ratedAt, "2024-12-21T14:12:07.000Z");
  assert.equal(bioshock.addedAt, "2024-12-21T14:12:07.000Z");
});

test("buildPlan: sin Ownership no es tuyo, aunque esté en la colección", () => {
  const { games } = buildPlan(COL, "", "");
  assert.equal(games.find((g) => g.igdbId === 222095)!.owned, false);
  assert.equal(games.find((g) => g.igdbId === 20)!.owned, true);
});

/* ───────────────────────── Fundir sin pisar ────────────────────────────── */

const plan = (over: Partial<PlannedGame> = {}): PlannedGame => ({
  igdbId: 1, name: "Hades", from: "collection", owned: true, minutes: 600,
  playState: null, finished: false, finishedAt: null, rating: 8,
  ratedAt: "2024-12-21T14:12:07.000Z", addedAt: "2024-12-21T14:12:07.000Z",
  playedAt: "2024-12-21T14:12:07.000Z", ...over,
});

const entry = (over: Partial<CurrentEntry> = {}): CurrentEntry => ({
  play_state: null, minutes_played: 0, minutes_source: null, owned: false,
  added_at: "2026-08-24T10:00:00.000Z", ...over,
});

test("decideEntry: fila nueva se escribe entera", () => {
  const { patch, conflicts } = decideEntry(plan(), null);
  assert.deepEqual(conflicts, []);
  assert.equal(patch.followed, true);
  assert.equal(patch.owned, true);
  assert.equal(patch.minutes_played, 600);
  assert.equal(patch.minutes_source, "manual");
  assert.equal(patch.added_at, "2024-12-21T14:12:07.000Z");
});

test("decideEntry: un estado ya dicho no se pisa, se cuenta", () => {
  const { patch, conflicts } = decideEntry(
    plan({ playState: "dropped" }),
    entry({ play_state: "playing" }),
  );
  assert.equal(patch.play_state, undefined);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /estado ya dicho 'playing'/);
});

test("decideEntry: unas horas escritas a mano no las corrige un CSV", () => {
  const { patch, conflicts } = decideEntry(
    plan({ minutes: 600 }),
    entry({ minutes_played: 2400, minutes_source: "manual" }),
  );
  assert.equal(patch.minutes_played, undefined);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /2400 min en la cuenta \(manual\), 600 min en el CSV/);
});

test("decideEntry: las de Steam sí se amplían — el CSV ve la consola y Steam no", () => {
  const { patch, conflicts } = decideEntry(
    plan({ minutes: 900 }),
    entry({ minutes_played: 600, minutes_source: "steam" }),
  );
  assert.equal(patch.minutes_played, 900);
  assert.equal(patch.minutes_source, "manual");
  assert.deepEqual(conflicts, []);
});

test("decideEntry: unas horas de Steam MAYORES no se recortan", () => {
  const { patch, conflicts } = decideEntry(
    plan({ minutes: 300 }),
    entry({ minutes_played: 600, minutes_source: "steam" }),
  );
  assert.equal(patch.minutes_played, undefined);
  assert.equal(conflicts.length, 1);
});

test("decideEntry: added_at se queda con la más antigua", () => {
  const { patch } = decideEntry(plan(), entry({ added_at: "2026-08-24T10:00:00.000Z" }));
  assert.equal(patch.added_at, "2024-12-21T14:12:07.000Z");
});

test("decideEntry: added_at no se adelanta si la de la cuenta ya es más antigua", () => {
  const { patch } = decideEntry(plan(), entry({ added_at: "2023-01-01T00:00:00.000Z" }));
  assert.equal(patch.added_at, undefined);
});

test("decideEntry: owned solo sube", () => {
  assert.equal(decideEntry(plan({ owned: true }), entry({ owned: false })).patch.owned, true);
  assert.equal(decideEntry(plan({ owned: false }), entry({ owned: true })).patch.owned, undefined);
});
