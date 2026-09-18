/* La matriz del importador de notas de IMDb. Lo que se prueba es la única
   decisión que puede equivocarse sin que nada falle: qué fila se ESCRIBE.

   Muerde por los dos lados. Decir que sí de más son ~4.700 UPDATE seguidos por
   pasada de filas que no se movieron —era el runtime entero del cron, y de ahí
   salían los Gateway Timeout—. Decir que no de más congela una nota para
   siempre y el registro dice que todo fue bien. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { episodeNeedsWrite, showNeedsWrite, type Stored } from "./lib.ts";

const guardado = (rating: number | null, votes: number | null): Stored => ({
  imdb_rating: rating,
  imdb_votes: votes,
});

// ── series ──────────────────────────────────────────────────────────────────

test("la serie que no se movió no se escribe: es el caso de casi las 4.700", () => {
  assert.equal(showNeedsWrite(guardado(8.7, 500_000), 8.7, 501_000), false);
});

test("la serie que cambió de nota se escribe", () => {
  assert.equal(showNeedsWrite(guardado(8.7, 500_000), 8.8, 500_000), true);
});

test("sin nota guardada se escribe: es la serie recién abierta, el caso que justifica la cadencia", () => {
  assert.equal(showNeedsWrite(guardado(null, null), 8.7, 500_000), true);
});

test("con nota pero sin votos se escribe: si no, el tooltip se queda en null para siempre", () => {
  assert.equal(showNeedsWrite(guardado(8.7, null), 8.7, 500_000), true);
});

test("los votos se ponen al día solos cuando derivan un 5%, aunque la nota no se mueva", () => {
  // Sin esto, una serie de nota quieta no vuelve a tocarse nunca y su recuento
  // de votos envejece sin límite.
  assert.equal(showNeedsWrite(guardado(8.7, 100_000), 8.7, 104_900), false);
  assert.equal(showNeedsWrite(guardado(8.7, 100_000), 8.7, 105_000), true);
});

test("los votos que BAJAN también cuentan como deriva: IMDb reajusta recuentos", () => {
  assert.equal(showNeedsWrite(guardado(8.7, 100_000), 8.7, 94_000), true);
});

test("IMDb publica un decimal: media pulgada no es un cambio", () => {
  assert.equal(showNeedsWrite(guardado(8.7, 500_000), 8.74, 500_000), false);
  assert.equal(showNeedsWrite(guardado(8.7, 500_000), 8.75, 500_000), true);
});

// ── episodios ───────────────────────────────────────────────────────────────

test("el episodio completo y con la misma nota no se escribe", () => {
  assert.equal(episodeNeedsWrite(guardado(9.5, 504_738), 9.5), false);
});

test("el episodio con nota pero SIN votos se escribe: los 11258 que dejó OMDb", () => {
  // Comparar solo por la nota los dejaba varados: coincidía, no se tocaban, y
  // sus votos se quedaban en null para siempre.
  assert.equal(episodeNeedsWrite(guardado(9.5, null), 9.5), true);
});

test("el episodio sin nada se escribe", () => {
  assert.equal(episodeNeedsWrite(guardado(null, null), 8.1), true);
});

test("el episodio cuya nota se movió se escribe", () => {
  assert.equal(episodeNeedsWrite(guardado(9.5, 504_738), 9.4), true);
});

test("los votos del episodio NO abren escritura: son ~40k filas y su recuento se asienta pronto", () => {
  assert.equal(episodeNeedsWrite(guardado(9.5, 100_000), 9.5), false);
});
