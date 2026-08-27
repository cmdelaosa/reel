import assert from "node:assert/strict";
import { test } from "node:test";
import { priceCents, queueFor, volumeOf, STALE_MS } from "./lib.ts";

const NOW = Date.parse("2026-08-27T04:10:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("priceCents lee el formato de cada mercado", () => {
  assert.equal(priceCents("32,93€"), 3293);
  assert.equal(priceCents("$1,234.56"), 123456);
  assert.equal(priceCents("12€"), 1200);
  assert.equal(priceCents("0,03€"), 3);
  assert.equal(priceCents(""), null);
});

test("el punto de 'руб.' no multiplica el precio por cien", () => {
  // La misma trampa que en app/src/domain/steamPortfolio.ts, y por eso la misma
  // prueba: ese punto es de la abreviatura, sobrevive al filtro, rompe el match
  // de los decimales y manda la cifra por la rama de "sin decimales".
  assert.equal(priceCents("1 234,56 руб."), 123456);
});

test("volumeOf quita el separador de miles", () => {
  assert.equal(volumeOf("1,234"), 1234);
  assert.equal(volumeOf("112"), 112);
  assert.equal(volumeOf(null), null);
});

test("lo que no tiene precio va primero", () => {
  const q = queueFor(
    [
      { appid: 730, market_hash_name: "viejo" },
      { appid: 730, market_hash_name: "sin precio" },
    ],
    [{ appid: 730, market_hash_name: "viejo", fetched_at: ago(STALE_MS + 1000), source: "server" }],
    NOW,
  );
  assert.deepEqual(q.map((x) => x.name), ["sin precio", "viejo"]);
});

test("un precio de cliente va antes que uno de servidor rancio", () => {
  // El de cliente es provisional por definición: lo trajo el navegador de
  // alguien y nadie lo ha confirmado.
  const q = queueFor(
    [
      { appid: 730, market_hash_name: "servidor rancio" },
      { appid: 730, market_hash_name: "cliente" },
    ],
    [
      { appid: 730, market_hash_name: "servidor rancio", fetched_at: ago(STALE_MS * 3), source: "server" },
      { appid: 730, market_hash_name: "cliente", fetched_at: ago(1000), source: "client" },
    ],
    NOW,
  );
  assert.deepEqual(q.map((x) => x.name), ["cliente", "servidor rancio"]);
});

test("lo fresco NO entra en la cola", () => {
  // Es lo que hace que la cola se vacíe. Con lo fresco dentro, el "quedan N" no
  // baja nunca de la cuenta total y el cron se pasa la noche volviendo a
  // preguntar precios que trajo hace diez minutos.
  const q = queueFor(
    [{ appid: 730, market_hash_name: "recién traído" }],
    [{ appid: 730, market_hash_name: "recién traído", fetched_at: ago(60_000), source: "server" }],
    NOW,
  );
  assert.deepEqual(q, []);
});

test("a las 20 h ya es rancio, para no perder la carrera contra el propio cron", () => {
  // Si el umbral fuera 24 h, la pasada de mañana a la misma hora vería el precio
  // con 23 h 59 min y no lo tocaría: cada precio se refrescaría en días
  // alternos.
  const casi = queueFor(
    [{ appid: 730, market_hash_name: "x" }],
    [{ appid: 730, market_hash_name: "x", fetched_at: ago(STALE_MS - 60_000), source: "server" }],
    NOW,
  );
  const pasado = queueFor(
    [{ appid: 730, market_hash_name: "x" }],
    [{ appid: 730, market_hash_name: "x", fetched_at: ago(STALE_MS + 60_000), source: "server" }],
    NOW,
  );
  assert.equal(casi.length, 0);
  assert.equal(pasado.length, 1);
});

test("un mismo nombre en dos appid son dos objetos", () => {
  // Un cromo de 753 y una caja de 730 pueden llamarse igual y valen cosas
  // distintas; el precio de uno no sirve para el otro.
  const q = queueFor(
    [
      { appid: 730, market_hash_name: "igual" },
      { appid: 753, market_hash_name: "igual" },
    ],
    [{ appid: 730, market_hash_name: "igual", fetched_at: ago(1000), source: "server" }],
    NOW,
  );
  assert.deepEqual(q, [{ appid: 753, name: "igual" }]);
});

test("una fecha ilegible no deja la fila fuera para siempre", () => {
  // Comparar con NaN da siempre false, así que sin el guardia esa fila no
  // entraría nunca en la cola y se quedaría con su precio viejo sin que nada lo
  // dijera.
  const q = queueFor(
    [{ appid: 730, market_hash_name: "x" }],
    [{ appid: 730, market_hash_name: "x", fetched_at: "no es una fecha", source: "server" }],
    NOW,
  );
  assert.equal(q.length, 1);
});

test("el mismo objeto repetido en varios inventarios se pregunta una vez", () => {
  // Es lo que hace que la caché global sirva de algo: tres personas con la misma
  // cápsula son una petición a Steam, no tres.
  const q = queueFor(
    [
      { appid: 730, market_hash_name: "Chroma 3 Case" },
      { appid: 730, market_hash_name: "Chroma 3 Case" },
      { appid: 730, market_hash_name: "Chroma 3 Case" },
    ],
    [],
    NOW,
  );
  assert.equal(q.length, 1);
});
