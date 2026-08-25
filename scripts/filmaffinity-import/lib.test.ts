/**
 * La matriz del emparejador. Lo que se juzga aquí es la única decisión que este
 * importador no puede deshacer solo: a qué película de TMDB va a parar una fila
 * de FilmAffinity. Un falso positivo escribe una nota tuya sobre una peli que no
 * viste, y eso no da la cara — nadie revisa 1.000 fichas.
 *
 *   node --test --experimental-strip-types lib.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  faDateToIso,
  firstDirector,
  isFilm,
  keepItem,
  norm,
  pickMatch,
  titleScore,
  titleVariants,
  type Candidate,
  type FaItem,
} from "./lib.ts";

const fa = (over: Partial<FaItem> = {}): FaItem => ({
  id: "1", title: "Blade Runner 2049", year: "2017", types: [], director: "Denis Villeneuve",
  url: "", rating: 8, date: "1/01/2020", ...over,
});

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: 335984, title: "Blade Runner 2049", original_title: "Blade Runner 2049",
  release_date: "2017-10-04", popularity: 50, ...over,
});

// ── qué es cine y qué no ────────────────────────────────────────────────────
test("isFilm: series, miniseries, shows y episodios fuera; el resto dentro", () => {
  assert.equal(isFilm([]), true);
  assert.equal(isFilm(["Documental"]), true);
  assert.equal(isFilm(["TV"]), true);
  assert.equal(isFilm(["Cortometraje", "Animación"]), true);
  assert.equal(isFilm(["Serie"]), false);
  assert.equal(isFilm(["Miniserie", "Documental"]), false);
  assert.equal(isFilm(["Episodio", "Animación"]), false);
  assert.equal(isFilm(["Show", "Mediometraje"]), false);
});

test("keepItem: las exclusiones opcionales no rescatan lo que no era cine", () => {
  assert.equal(keepItem(["Cortometraje"], []), true);
  assert.equal(keepItem(["Cortometraje"], ["Cortometraje"]), false);
  assert.equal(keepItem(["Cortometraje", "TV"], ["TV"]), false);
  // Una serie sigue fuera aunque no se excluya nada.
  assert.equal(keepItem(["Serie"], []), false);
});

// ── normalización y variantes de título ─────────────────────────────────────
test("norm: acentos, mayúsculas y puntuación se van", () => {
  assert.equal(norm("¡Átame!"), "atame");
  assert.equal(norm("WALL·E"), "wall e");
  assert.equal(norm("Amélie"), "amelie");
});

test("titleVariants: el título doble de FA da las dos mitades y el entero", () => {
  assert.deepEqual(titleVariants("Las vidas de Grace (Short Term 12)"), [
    "Las vidas de Grace (Short Term 12)", "Las vidas de Grace", "Short Term 12",
  ]);
  assert.deepEqual(titleVariants("Mud"), ["Mud"]);
});

test("firstDirector: se queda con el primero y sin el rol", () => {
  assert.equal(firstDirector("Bill Lawrence (Creador), Matt Tarses (Creador) ..."), "Bill Lawrence");
  assert.equal(firstDirector("Denis Villeneuve"), "Denis Villeneuve");
});

// ── la fecha ────────────────────────────────────────────────────────────────
test("faDateToIso: D/M/AAAA a mediodía UTC, para que el día no se corra", () => {
  assert.equal(faDateToIso("8/07/2026"), "2026-07-08T12:00:00Z");
  assert.equal(faDateToIso("27/12/2024"), "2024-12-27T12:00:00Z");
  assert.equal(faDateToIso("mañana"), null);
});

// ── el emparejador ──────────────────────────────────────────────────────────
test("titleScore: 2 exacto, 1 contenido, 0 nada", () => {
  assert.equal(titleScore("Blade Runner 2049", cand()), 2);
  assert.equal(titleScore("Blade Runner", cand()), 1);
  assert.equal(titleScore("Dune", cand()), 0);
  // El original también cuenta, que es como casa un título en inglés.
  assert.equal(titleScore("Short Term 12", cand({ title: "Las vidas de Grace", original_title: "Short Term 12" })), 2);
});

test("pickMatch: título idéntico y año a ±1 → exact", () => {
  const m = pickMatch(fa(), [cand()]);
  assert.equal(m?.candidate.id, 335984);
  assert.equal(m?.confidence, "exact");
});

test("pickMatch: dos años de diferencia no vale", () => {
  assert.equal(pickMatch(fa({ year: "2015" }), [cand()]), null);
});

test("pickMatch: título solo parcial pide confirmación del director", () => {
  const m = pickMatch(fa({ title: "Blade Runner" }), [cand()]);
  assert.equal(m?.confidence, "needs-director");
});

test("pickMatch: entre homónimos del mismo año gana el más popular", () => {
  const viejo = cand({ id: 1, popularity: 3 });
  const nuevo = cand({ id: 2, popularity: 90 });
  assert.equal(pickMatch(fa(), [viejo, nuevo])?.candidate.id, 2);
});

test("pickMatch: el título idéntico gana al parcial aunque el parcial sea más popular", () => {
  const parcial = cand({ id: 1, title: "Blade Runner", original_title: "Blade Runner", popularity: 999 });
  const exacto = cand({ id: 2, popularity: 1 });
  const m = pickMatch(fa(), [parcial, exacto]);
  assert.equal(m?.candidate.id, 2);
  assert.equal(m?.confidence, "exact");
});

test("pickMatch: sin fecha en TMDB no hay año que comparar, así que no vale", () => {
  assert.equal(pickMatch(fa(), [cand({ release_date: null })]), null);
});

test("pickMatch: candidatos vacíos → null", () => {
  assert.equal(pickMatch(fa(), []), null);
});
