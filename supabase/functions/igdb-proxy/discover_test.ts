import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  anticipatedQuery,
  NEW_MIN_VOTES,
  NEW_WINDOW_DAYS,
  newReleasesQuery,
  popularQuery,
  TOP_RATED_MIN_VOTES,
  topRatedQuery,
} from "./discover.ts";

const FIELDS = "name,cover.image_id";
// 24-ago-2026, 00:00 UTC. Fijo: una consulta que dependa del reloj de quien
// ejecuta las pruebas no se puede afirmar en un test.
const NOW_MS = Date.UTC(2026, 7, 24);
const NOW_S = Math.floor(NOW_MS / 1000);

Deno.test("las fechas van en SEGUNDOS, no en milisegundos", () => {
  // La avería que esta prueba existe para impedir no da error: IGDB acepta la
  // consulta y devuelve cero filas, porque una ventana en milisegundos empieza
  // dentro de unos cincuenta mil años. La rejilla sale vacía y el log, limpio.
  assertStringIncludes(anticipatedQuery(FIELDS, NOW_MS), `first_release_date > ${NOW_S}`);
  assert(!anticipatedQuery(FIELDS, NOW_MS).includes(String(NOW_MS)));

  const q = newReleasesQuery(FIELDS, NOW_MS);
  const since = NOW_S - NEW_WINDOW_DAYS * 24 * 3600;
  assertStringIncludes(q, `first_release_date >= ${since}`);
  assertStringIncludes(q, `first_release_date <= ${NOW_S}`);
});

Deno.test("la ventana de novedades está acotada por los dos lados", () => {
  // Sin tope por arriba, un juego con fecha de 2031 metida por error en el
  // catálogo encabeza "Novedades" para siempre.
  const q = newReleasesQuery(FIELDS, NOW_MS);
  // Dos condiciones sobre la fecha dentro del WHERE — el `sort` menciona el
  // mismo campo, así que se cuenta solo lo que hay antes de él.
  const where = q.slice(0, q.indexOf("sort"));
  assertEquals(where.match(/first_release_date/g)?.length, 2);
  assertStringIncludes(q, "sort first_release_date desc");
});

Deno.test("mejor valorados lleva suelo de votos, y ordena por nota", () => {
  // La propiedad que da sentido a esta consulta: sin el suelo, la lista es un
  // muestrario de juegos con UN voto de 100/100.
  const q = topRatedQuery(FIELDS);
  assertStringIncludes(q, `total_rating_count >= ${TOP_RATED_MIN_VOTES}`);
  assertStringIncludes(q, "sort total_rating desc");
  assert(TOP_RATED_MIN_VOTES >= NEW_MIN_VOTES * 10, "el suelo de nota tiene que ser el más alto");
});

Deno.test("populares ordena por votos y no por nota", () => {
  const q = popularQuery(FIELDS);
  assertStringIncludes(q, "sort total_rating_count desc");
  assert(!q.includes("sort total_rating desc"));
});

Deno.test("las cuatro filtran ediciones y no-juegos dentro del WHERE", () => {
  // Filtrar al recibir gasta el `limit` en filas que se van a tirar — es el
  // mismo fallo que dejaba "mario kart" sin un solo resultado (rank.ts).
  for (const q of [
    anticipatedQuery(FIELDS, NOW_MS),
    newReleasesQuery(FIELDS, NOW_MS),
    popularQuery(FIELDS),
    topRatedQuery(FIELDS),
  ]) {
    assertStringIncludes(q, "version_parent = null");
    assertStringIncludes(q, "game_type");
    // El filtro tiene que estar ANTES del sort, o sea dentro del where.
    assert(q.indexOf("game_type") < q.indexOf("sort"), q);
    assertStringIncludes(q, `fields ${FIELDS};`);
  }
});
