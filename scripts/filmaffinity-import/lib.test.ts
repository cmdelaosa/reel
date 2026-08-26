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
  dice,
  directorMatches,
  FA_ALIASES,
  faDateToIso,
  firstDirector,
  isFilm,
  keepItem,
  listAddedAt,
  norm,
  pickMatch,
  queryVariants,
  titleScore,
  titleVariants,
  tokens,
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

test("queryVariants: el título largo se pregunta también por partes", () => {
  // TMDB devuelve CERO por el título entero y la película por cualquier mitad.
  const v = queryVariants("El Hobbit: La batalla de los cinco ejércitos");
  assert.ok(v.includes("El Hobbit"));
  assert.ok(v.includes("La batalla de los cinco ejércitos"));
});

// ── numerales y abreviaturas ────────────────────────────────────────────────
test("tokens: los romanos pasan a arábigos y las abreviaturas se abren", () => {
  assert.deepEqual(tokens("Misión imposible II"), ["mision", "imposible", "2"]);
  assert.deepEqual(tokens("Dr. Strange"), ["doctor", "strange"]);
  assert.deepEqual(tokens("Guardianes Vol. 3"), ["guardianes", "volumen", "3"]);
});

test("dice: la misma película con otras palabras se parece; su secuela no", () => {
  assert.ok(dice("El padrino. Parte II", "El padrino II") >= 0.6);
  assert.ok(dice("El padrino. Parte II", "El padrino III") < 0.6);
});

test("titleScore: la redacción distinta del mismo título llega a 1, no a 2", () => {
  const padrino = cand({ title: "El padrino II", original_title: "The Godfather Part II", release_date: "1974-12-20" });
  assert.equal(titleScore("El padrino. Parte II", padrino), 1);
  // Y con el numeral unificado, "2" y "II" son el mismo título: 2 sin más.
  const mi2 = cand({ title: "Misión imposible II", original_title: "Mission: Impossible II" });
  assert.equal(titleScore("Misión imposible 2", mi2), 2);
});

test("titleScore: la secuela de al lado no llega ni a 1", () => {
  // Lo que salva a la saga es el numeral: sin él, "El padrino. Parte II" se
  // parecería a las tres. Con él, la III se queda en 0,57 de Dice y fuera.
  const padrino3 = cand({ title: "El padrino III", original_title: "The Godfather Part III" });
  assert.equal(titleScore("El padrino. Parte II", padrino3), 0);
});

// ── la confirmación del director ────────────────────────────────────────────
test("directorMatches: el apellido confirma; el nombre de pila solo, no", () => {
  assert.equal(directorMatches("Denis Villeneuve", ["Denis Villeneuve"]), true);
  // Acentos y grafías: por eso no vale la igualdad estricta.
  assert.equal(directorMatches("Emilio Martínez-Lázaro", ["Emilio Martinez Lazaro"]), true);
  assert.equal(directorMatches("Kim Jee-woon", ["Kim Jee-woon"]), true);
  // El fallo que esto cierra: dos personas distintas con el mismo nombre.
  assert.equal(directorMatches("Bill Lawrence", ["Bill Murray"]), false);
  assert.equal(directorMatches("Steve Oedekerk", ["Steve McQueen"]), false);
});

test("directorMatches: el rol y los coautores no estorban, y sin director es que no", () => {
  assert.equal(directorMatches("Bill Lawrence (Creador), Matt Tarses (Creador) ...", ["Bill Lawrence"]), true);
  assert.equal(directorMatches("", ["Quien sea"]), false);
  assert.equal(directorMatches("Denis Villeneuve", []), false);
});

test("FA_ALIASES: claves de FA en texto, ids de TMDB en número", () => {
  // Un id de FA escrito como número no encontraría nunca su fila (las del
  // scrape son cadenas), y el alias se saltaría en silencio.
  for (const [faId, tmdbId] of Object.entries(FA_ALIASES)) {
    assert.match(faId, /^\d+$/);
    assert.equal(typeof tmdbId, "number");
    assert.ok(tmdbId > 0);
  }
});

test("listAddedAt: la posición reparte segundos, y el orden es el de la lista", () => {
  const base = new Date("2026-08-25T20:10:00Z");
  assert.equal(listAddedAt(base, 1), "2026-08-25T20:10:01.000Z");
  assert.equal(listAddedAt(base, 320), "2026-08-25T20:15:20.000Z");
  // Lo que de verdad importa: ordenar por esta fecha da el orden de FA.
  const pos = [7, 3, 100, 1];
  const ordenadas = pos.map((p) => ({ p, at: listAddedAt(base, p) })).sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(ordenadas.map((x) => x.p), [1, 3, 7, 100]);
  // Y las 320 caben en cinco minutos: sigue siendo el momento de la importación.
  assert.ok(new Date(listAddedAt(base, 320)).getTime() - base.getTime() < 6 * 60 * 1000);
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
