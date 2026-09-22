/* La matriz del cron de notas de Steam. Lo que se prueba aquí son las dos
   decisiones que se pueden equivocar sin que nada falle: a quién se pregunta y
   en qué orden, y qué respuesta de la tienda autoriza a ESCRIBIR una columna.
   La segunda es la que muerde: confundir «no ha contestado» con «no tiene nota»
   borra datos buenos y el registro dice que todo fue bien. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  appidDeLaBusqueda,
  esSatelite,
  fichaDeTienda,
  metacriticOf,
  queueFor,
  reviewsOf,
  STALE_MS,
  type Game,
} from "./lib.ts";

const AHORA = Date.parse("2026-08-28T04:00:00Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

function juego(over: Partial<Game> & { id: string }): Game {
  return {
    name: `juego ${over.id}`,
    steam_appid: 1000 + Number(over.id),
    metacritic: null,
    metacritic_source: null,
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
  assert.deepEqual(cola, [{ id: "1", name: "730", appid: 730, source: null }]);
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

/* ── El appid que no es el del juego (0103) ────────────────────────────────
   Las tres formas medidas contra la tienda el 21-sep-2026, con sus payloads
   recortados a lo que se lee. Lo que estas pruebas vigilan es que las dos
   averías se distingan entre sí Y del juego recién salido, que también tiene
   cero reseñas y al que no hay nada que corregirle. */

const basic = (pedido: number, data: Record<string, unknown> | null) => ({
  [String(pedido)]: data ? { success: true, data } : { success: false },
});

test("fichaDeTienda: la tienda devuelve el appid canónico de una entrada secundaria", () => {
  // Dead Cells: IGDB da 1087210 y appdetails contesta con steam_appid 588650.
  const ficha = fichaDeTienda(basic(1087210, { name: "Dead Cells", steam_appid: 588650 }), 1087210);
  assert.deepEqual(ficha, { appid: 588650, name: "Dead Cells" });
});

test("fichaDeTienda: un appid que no redirige se devuelve tal cual", () => {
  const ficha = fichaDeTienda(basic(588650, { name: "Dead Cells", steam_appid: 588650 }), 588650);
  assert.deepEqual(ficha, { appid: 588650, name: "Dead Cells" });
});

test("fichaDeTienda: sin `steam_appid` en la respuesta manda el que se pidió", () => {
  assert.deepEqual(fichaDeTienda(basic(70, { name: "Half-Life" }), 70), { appid: 70, name: "Half-Life" });
});

test("fichaDeTienda: un juego retirado no dice nada — null, no un appid", () => {
  // `success: false` es región o retirada, y deducir de ahí que el appid está
  // mal llevaría a buscarle otro a un juego que lo tiene bien.
  assert.equal(fichaDeTienda(basic(999999, null), 999999), null);
  assert.equal(fichaDeTienda(null, 70), null);
  assert.equal(fichaDeTienda({}, 70), null);
});

test("esSatelite: el playtest de un juego no es el juego", () => {
  assert.equal(esSatelite("Chants Of Sennaar Playtest", "Chants of Sennaar"), true);
  assert.equal(esSatelite("Hades II Demo", "Hades II"), true);
  assert.equal(esSatelite("Chants of Sennaar - Original Soundtrack", "Chants of Sennaar"), true);
});

test("esSatelite: la ficha del propio juego no es un satélite", () => {
  assert.equal(esSatelite("Chants of Sennaar", "Chants of Sennaar"), false);
  assert.equal(esSatelite("Dead Cells", "Dead Cells"), false);
  assert.equal(esSatelite("", "Dead Cells"), false);
});

test("esSatelite: la palabra DENTRO del nombre no cuenta", () => {
  /* Con nombres que NO son el del juego, que es donde esta regla se juega algo:
     con el nombre idéntico la función sale por la puerta de arriba y la lista
     de satélites ni llega a mirarse.

     Si contara la palabra suelta, la edición de «Beta Squad» pasaría por el
     playtest de alguien: se le buscaría otro appid y acabaría con el de otro
     juego. Solo al final, que es como Steam los nombra. */
  assert.equal(esSatelite("Beta Squad Deluxe Edition", "Beta Squad"), false);
  assert.equal(esSatelite("Demolition Company Gold", "Demolition Company"), false);
  assert.equal(esSatelite("Test Drive Unlimited 2", "Test Drive Unlimited"), false);
});

test("esSatelite: un juego que SE LLAMA como un satélite se deja en paz", () => {
  /* El nombre de la app es idéntico al del juego: sea lo que sea esa palabra,
     no lo convierte en el satélite de nadie. */
  assert.equal(esSatelite("Demo", "Demo"), false);
});

test("appidDeLaBusqueda: se queda con el nombre exacto, no con el primero", () => {
  /* La respuesta real de «Dead Cells»: el juego y cinco DLC detrás. Con un
     `items[0]` o un «contiene», esto casaría igual de contento con el DLC. */
  const payload = {
    items: [
      { id: 2101430, name: "Dead Cells: Return to Castlevania" },
      { id: 588650, name: "Dead Cells" },
      { id: 1451460, name: "Dead Cells: Fatal Falls" },
    ],
  };
  assert.equal(appidDeLaBusqueda(payload, "Dead Cells"), 588650);
});

test("appidDeLaBusqueda: la puntuación y las mayúsculas no cuentan", () => {
  const payload = { items: [{ id: 1931770, name: "Chants of Sennaar" }] };
  assert.equal(appidDeLaBusqueda(payload, "Chants Of  Sennaar"), 1931770);
});

test("appidDeLaBusqueda: sin nombre exacto no se escribe nada", () => {
  /* Preferir «lo más parecido» es como acaba en la biblioteca el juego que no
     era. Sin certeza, null: la fila se queda como está y se vuelve a intentar
     la semana que viene. */
  const payload = { items: [{ id: 2283300, name: "Chants of Sennaar Demo" }] };
  assert.equal(appidDeLaBusqueda(payload, "Chants of Sennaar"), null);
  assert.equal(appidDeLaBusqueda({ items: [] }, "Chants of Sennaar"), null);
  assert.equal(appidDeLaBusqueda(null, "Chants of Sennaar"), null);
  assert.equal(appidDeLaBusqueda({ items: [{ id: 1, name: "X" }] }, ""), null);
});

test("appidDeLaBusqueda: dos fichas con el mismo nombre no se resuelven a cara o cruz", () => {
  /* El Prey de 2006 y el de 2017 son juegos distintos con el mismo nombre y su
     ficha cada uno en la tienda. Quedarse con el primero escribiría en la base
     —marcado como «lo dice la tienda», o sea a prueba de correcciones de IGDB—
     un appid elegido al azar. */
  const payload = { items: [{ id: 3970, name: "Prey" }, { id: 480490, name: "Prey" }] };
  assert.equal(appidDeLaBusqueda(payload, "Prey"), null);
});

test("appidDeLaBusqueda: el mismo id repetido sigue siendo uno", () => {
  const payload = {
    items: [{ id: 588650, name: "Dead Cells" }, { id: 588650, name: "Dead  Cells" }],
  };
  assert.equal(appidDeLaBusqueda(payload, "Dead Cells"), 588650);
});
