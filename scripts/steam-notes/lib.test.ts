/* La matriz del cron de notas de Steam. Lo que se prueba aquí son las dos
   decisiones que se pueden equivocar sin que nada falle: a quién se pregunta y
   en qué orden, y qué respuesta de la tienda autoriza a ESCRIBIR una columna.
   La segunda es la que muerde: confundir «no ha contestado» con «no tiene nota»
   borra datos buenos y el registro dice que todo fue bien. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { metacriticOf, queueFor, reviewsOf, STALE_MS, type Game } from "./lib.ts";

const AHORA = Date.parse("2026-08-28T04:00:00Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

function juego(over: Partial<Game> & { id: string }): Game {
  return {
    name: `juego ${over.id}`,
    steam_appid: 1000 + Number(over.id),
    metacritic: null,
    steam_reviews: null,
    steam_notes_refreshed_at: null,
    ...over,
  };
}

test("la cola: primero lo que nunca se preguntó, luego lo rancio de más viejo a más nuevo", () => {
  const cola = queueFor(
    [
      juego({ id: "1", steam_notes_refreshed_at: hace(STALE_MS + 60_000) }),
      juego({ id: "2", steam_notes_refreshed_at: hace(STALE_MS * 3) }),
      juego({ id: "3" }),
      juego({ id: "4", steam_notes_refreshed_at: hace(60_000) }),
    ],
    AHORA,
  );
  assert.deepEqual(cola.map((x) => x.id), ["3", "2", "1"]);
});

test("lo fresco no entra: sin esto, el tope por pasada se lo comen siempre los mismos", () => {
  const cola = queueFor([juego({ id: "1", steam_notes_refreshed_at: hace(STALE_MS - 1000) })], AHORA);
  assert.equal(cola.length, 0);
});

test("una marca ilegible es el principio de los tiempos, no NaN que se cae de la cola", () => {
  const cola = queueFor([juego({ id: "1", steam_notes_refreshed_at: "ayer por la tarde" })], AHORA);
  assert.deepEqual(cola.map((x) => x.id), ["1"]);
});

test("un juego sin nombre entra igual, identificado por su appid", () => {
  const cola = queueFor([juego({ id: "1", name: null, steam_appid: 730 })], AHORA);
  assert.deepEqual(cola, [{ id: "1", name: "730", appid: 730 }]);
});

test("un appid imposible no se pregunta", () => {
  assert.equal(queueFor([juego({ id: "1", steam_appid: 0 })], AHORA).length, 0);
});

test("reseñas: el porcentaje se calcula, no se copia el review_score de Steam", () => {
  assert.deepEqual(
    reviewsOf({ query_summary: { total_positive: 856_026, total_reviews: 884_788, review_score: 9 } }),
    { touch: true, value: { percent: 97, count: 884_788 } },
  );
});

test("reseñas: cero reseñas es una RESPUESTA (null), no un fallo", () => {
  assert.deepEqual(reviewsOf({ query_summary: { total_positive: 0, total_reviews: 0 } }), {
    touch: true,
    value: null,
  });
});

test("reseñas: sin query_summary no se toca la columna aunque el HTTP fuera 200", () => {
  assert.equal(reviewsOf({ success: 1 }).touch, false);
  assert.equal(reviewsOf(null).touch, false);
  assert.equal(reviewsOf({ query_summary: { total_reviews: "884788" } }).touch, false);
});

test("metacritic: la forma normal, con filters=metacritic", () => {
  assert.deepEqual(metacriticOf({ "292030": { success: true, data: { metacritic: { score: 93 } } } }, 292_030), {
    touch: true,
    value: 93,
  });
});

test("metacritic: success con data vacío es «no tiene nota» — se escribe null", () => {
  assert.deepEqual(metacriticOf({ "774171": { success: true, data: [] } }, 774_171), {
    touch: true,
    value: null,
  });
});

test("metacritic: success:false NO se escribe — es un juego retirado, no una nota que no existe", () => {
  assert.equal(metacriticOf({ "999999999": { success: false } }, 999_999_999).touch, false);
  assert.equal(metacriticOf({}, 292_030).touch, false);
  assert.equal(metacriticOf(null, 292_030).touch, false);
});

test("metacritic: la respuesta es del appid que se preguntó, no del primero que venga", () => {
  assert.equal(metacriticOf({ "292030": { success: true, data: { metacritic: { score: 93 } } } }, 570).touch, false);
});

test("metacritic: fuera de 0-100 o sin número, null antes que pintar un disparate", () => {
  assert.deepEqual(metacriticOf({ "1": { success: true, data: { metacritic: { score: 120 } } } }, 1), {
    touch: true,
    value: null,
  });
  assert.deepEqual(metacriticOf({ "1": { success: true, data: { metacritic: { score: "96" } } } }, 1), {
    touch: true,
    value: null,
  });
  assert.deepEqual(metacriticOf({ "1": { success: true, data: { metacritic: { score: 0 } } } }, 1), {
    touch: true,
    value: 0,
  });
});
