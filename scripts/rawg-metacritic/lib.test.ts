/* La matriz del cron de Metascores. Casi toda es sobre EMPAREJAR, que es lo
   único aquí que puede escribir un dato falso en vez de dejar un hueco.

   Las respuestas de abajo no son inventadas: son las que devolvió
   api.rawg.io/api/games el 28-08-2026, recortadas a los campos que se miran.
   Los tres casos son los que fallaron al probar el emparejamiento por nombre a
   secas, y por eso están aquí y no otros. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { emparejar, emparejarEdicion, norm, platKey, queueFor, scoreOf, sinEdicion, STALE_MS, type Candidato, type Game } from "./lib.ts";

const p = (...nombres: string[]) => nombres.map((name) => ({ platform: { name } }));

/* Búsqueda "Tetris". Ojo al segundo: un TETRIS de móvil de 2011 CON nota, que
   es el que se lleva quien coja el primer resultado con Metascore. */
const TETRIS: Candidato[] = [
  { id: 52623, name: "Tetris (1984)", released: "1984-06-06", metacritic: null, platforms: p("Game Boy", "SNES", "NES", "Genesis") },
  { id: 5731, name: "TETRIS", released: "2011-12-01", metacritic: 65, platforms: p("iOS", "Android") },
  { id: 213550, name: "Tetris.", released: "2016-04-15", metacritic: null, platforms: p("Web") },
  { id: 471027, name: "Tetris Effect: Connected", released: "2020-11-10", metacritic: 90, platforms: p("PC", "Nintendo Switch") },
  { id: 292838, name: "Tetris 99", released: "2019-02-13", metacritic: 83, platforms: p("Nintendo Switch") },
];

/* Búsqueda "Mission: Impossible". El de NES de 1990 tiene un 61; el nuestro, el
   de Nintendo 64 de 1998, no tiene nota. */
const MISION: Candidato[] = [
  { id: 53957, name: "Mission: Impossible (1990)", released: "1990-09-28", metacritic: 61, platforms: p("NES") },
  { id: 795384, name: "Mission: Impossible (GBC)", released: "2000-02-22", metacritic: null, platforms: p("Game Boy Color") },
  { id: 795383, name: "Mission: Impossible (1998)", released: "1998-08-14", metacritic: null, platforms: p("PlayStation", "Nintendo 64") },
  { id: 53427, name: "Mission: Impossible – Operation Surma", released: "2003-12-02", metacritic: 66, platforms: p("Xbox", "GameCube") },
];

const ZELDA: Candidato[] = [
  { id: 22511, name: "The Legend of Zelda: Breath of the Wild", released: "2017-03-03", metacritic: 97, platforms: p("Nintendo Switch", "Wii U") },
  { id: 509003, name: "The Legend of Zelda: Breath of the Wild Randomizer", released: "2020-10-21", metacritic: null, platforms: p("PC") },
  { id: 59631, name: "The Legend of Zelda: Breath of the Wild: Starter Pack", released: "2018-09-27", metacritic: null, platforms: p("Nintendo Switch") },
  { id: 327239, name: "The Legend of Zelda: Tears of the Kingdom", released: "2023-05-12", metacritic: 96, platforms: p("Nintendo Switch") },
];

test("Tetris: la consola manda, y el 65 del Tetris de móvil se queda fuera", () => {
  const elegido = emparejar(
    { name: "Tetris", first_air_date: "1989-06-14", platforms: ["Game Boy"] },
    TETRIS,
  );
  assert.equal(elegido?.id, 52623);
  assert.equal(scoreOf(elegido), null);
  /* Y da igual el orden en que RAWG los devuelva: si el acierto dependiera de
     que el bueno venga primero, esto acertaría hoy y fallaría el día que su
     buscador cambie de criterio, sin que nadie tocara nada. */
  const alReves = emparejar(
    { name: "Tetris", first_air_date: "1989-06-14", platforms: ["Game Boy"] },
    [...TETRIS].reverse(),
  );
  assert.equal(alReves?.id, 52623);
});

test("Mission: Impossible: entre el de NES y el de N64 elige por plataforma, no por nota", () => {
  const elegido = emparejar(
    { name: "Mission: Impossible", first_air_date: "1998-08-14", platforms: ["Nintendo 64"] },
    MISION,
  );
  assert.equal(elegido?.id, 795383);
  assert.equal(scoreOf(elegido), null);
});

test("Breath of the Wild: empareja aunque las fechas no coincidan, porque la consola sí", () => {
  /* Esta fila tiene fecha de 2025 —la edición de Switch 2— y RAWG la fecha en
     2017. Con el año como veto, el 97 se perdía. */
  const elegido = emparejar(
    { name: "The Legend of Zelda: Breath of the Wild", first_air_date: "2025-06-05", platforms: ["Nintendo Switch", "Nintendo Switch 2"] },
    ZELDA,
  );
  assert.equal(elegido?.id, 22511);
  assert.equal(scoreOf(elegido), 97);
});

test("un nombre parecido no es el mismo juego", () => {
  assert.equal(
    emparejar({ name: "The Legend of Zelda", first_air_date: "1986-02-21", platforms: ["NES"] }, ZELDA),
    null,
  );
});

test("sin plataforma común ni año cercano, no se empareja", () => {
  assert.equal(
    emparejar({ name: "Tetris", first_air_date: "1989-06-14", platforms: ["Nintendo Switch"] }, [TETRIS[1]!]),
    null,
  );
});

test("el año empareja cuando la plataforma no coincide en el nombre", () => {
  const elegido = emparejar(
    { name: "Tetris", first_air_date: "1984-01-01", platforms: ["Arcade"] },
    TETRIS,
  );
  assert.equal(elegido?.id, 52623);
});

test("una búsqueda vacía no empareja nada", () => {
  assert.equal(emparejar({ name: "Lo Que Sea", first_air_date: null, platforms: null }, []), null);
});

test("normalizar: mayúsculas, puntuación, ampersand y el año entre paréntesis", () => {
  assert.equal(norm("GHOST TRICK: Phantom Detective"), "ghost trick phantom detective");
  assert.equal(norm("Mario Kart: Double Dash!!"), norm("Mario Kart: Double Dash"));
  assert.equal(norm("Donkey Kong (1994)"), "donkey kong");
  assert.equal(norm("Astérix & Obélix"), "ast rix and ob lix");
});

test("las plataformas de los dos catálogos caen en la misma clave", () => {
  assert.equal(platKey("Super Nintendo Entertainment System"), platKey("SNES"));
  assert.equal(platKey("Nintendo Switch"), "switch");
  // La de Switch 2 NO puede caer en la de Switch: son dos consolas.
  assert.notEqual(platKey("Nintendo Switch 2"), platKey("Nintendo Switch"));
  assert.equal(platKey("PlayStation 4"), platKey("PS4"));
});

test("el Metascore fuera de 0-100, o que no es número, no se guarda", () => {
  assert.equal(scoreOf({ id: 1, name: "x", released: null, metacritic: 120 }), null);
  assert.equal(scoreOf({ id: 1, name: "x", released: null, metacritic: null }), null);
  assert.equal(scoreOf(null), null);
  assert.equal(scoreOf({ id: 1, name: "x", released: null, metacritic: 0 }), 0);
});

/* ── Las ediciones ───────────────────────────────────────────────────────
 *
 * La biblioteca tiene "…- Nintendo Switch 2 Edition", que en RAWG no existe con
 * ese nombre. El juego sí, y su Metascore es el del juego. */

const TOTK: Candidato[] = [
  { id: 327239, name: "The Legend of Zelda: Tears of the Kingdom", released: "2023-05-12", metacritic: 96, platforms: p("Nintendo Switch") },
];

test("la edición de Switch 2 hereda la nota del juego, que es de lo que se habla", () => {
  const juego = {
    name: "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition",
    first_air_date: "2025-06-05",
    platforms: ["Nintendo Switch 2"],
  };
  // Por nombre entero no empareja con nada: ese es el punto de partida.
  assert.equal(emparejar(juego, TOTK), null);
  const base = sinEdicion(juego.name);
  assert.equal(base, "The Legend of Zelda: Tears of the Kingdom");
  assert.equal(scoreOf(emparejarEdicion(juego, base!, TOTK)), 96);
});

test("se corta la coletilla de edición, y solo esa", () => {
  assert.equal(sinEdicion("Ticket to Ride: Classic Edition"), "Ticket to Ride");
  assert.equal(sinEdicion("The Witcher 3: Wild Hunt - Complete Edition"), "The Witcher 3: Wild Hunt");
  // Un subtítulo NO es una edición: aquí se perdería el juego entero.
  assert.equal(sinEdicion("Zelda II: The Adventure of Link"), null);
  assert.equal(sinEdicion("Half-Life 2"), null);
});

test("un remaster no hereda: la crítica lo puntúa aparte", () => {
  /* Valkyria Chronicles tiene un 86 y su remasterización un 80. Enseñar el 86
     en la remasterización sería enseñar la nota de otra cosa, así que estas dos
     etiquetas se quedan fuera a propósito. */
  assert.equal(sinEdicion("Valkyria Chronicles Remastered"), null);
  assert.equal(sinEdicion("Broken Sword: The Smoking Mirror - Remastered"), null);
  assert.equal(sinEdicion("Shadow of the Colossus - Remake"), null);
});

test("la edición no se empareja con un juego que se llame parecido", () => {
  const juego = {
    name: "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition",
    first_air_date: "2025-06-05",
    platforms: ["Nintendo Switch 2"],
  };
  /* Un randomizer y un pack de contenido de OTRO Zelda: se llaman parecido y no
     son el juego, así que la edición se queda sin nota antes que llevarse la de
     un vecino. */
  assert.equal(emparejarEdicion(juego, sinEdicion(juego.name)!, ZELDA.slice(1, 3)), null);
});

/* ── La cola ──────────────────────────────────────────────────────────── */

const AHORA = Date.parse("2026-08-28T05:00:00Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

function juego(over: Partial<Game> & { id: string }): Game {
  return {
    name: `juego ${over.id}`,
    first_air_date: null,
    platforms: null,
    metacritic: null,
    metacritic_source: null,
    rawg_id: null,
    rawg_refreshed_at: null,
    ...over,
  };
}

test("lo que ya tiene nota de Steam no entra: es la misma nota y ya está traída", () => {
  const cola = queueFor([juego({ id: "1", metacritic: 93, metacritic_source: "steam" })], AHORA);
  assert.equal(cola.length, 0);
});

test("lo que tiene nota DE RAWG sí vuelve, para poder refrescarla", () => {
  const cola = queueFor(
    [juego({ id: "1", metacritic: 91, metacritic_source: "rawg", rawg_refreshed_at: hace(STALE_MS * 2) })],
    AHORA,
  );
  assert.deepEqual(cola.map((x) => x.id), ["1"]);
});

test("primero lo que nunca se buscó, después lo rancio de más viejo a más nuevo", () => {
  const cola = queueFor(
    [
      juego({ id: "1", rawg_refreshed_at: hace(STALE_MS + 1000) }),
      juego({ id: "2", rawg_refreshed_at: hace(STALE_MS * 4) }),
      juego({ id: "3" }),
      juego({ id: "4", rawg_refreshed_at: hace(1000) }),
    ],
    AHORA,
  );
  assert.deepEqual(cola.map((x) => x.id), ["3", "2", "1"]);
});

test("el emparejamiento guardado viaja con la cola: la próxima vez no se busca por nombre", () => {
  const cola = queueFor([juego({ id: "1", rawg_id: 22511 })], AHORA);
  assert.equal(cola[0]?.rawg_id, 22511);
});
