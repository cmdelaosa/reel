import { test, expect, type Page, type Route } from "@playwright/test";

/* La segunda visita pinta la biblioteca ANTES de que conteste el rollup.
 *
 * QUÉ SE MIDE Y POR QUÉ ASÍ. El contrato de lib/queryPersistence es un orden de
 * sucesos —hay carátulas en pantalla mientras `rpc_library_rollup` sigue en el
 * aire—, y un orden no se comprueba con un cronómetro: se comprueba dejando la
 * petición ABIERTA. Aquí el rollup no responde hasta que el test lo suelta, así
 * que si la rejilla aparece es imposible que venga de la red. Un `expect` sobre
 * milisegundos habría medido lo mismo con una máquina cargada de por medio.
 *
 * LA PRUEBA DE QUE PUEDE FALLAR ESTÁ DENTRO. El segundo caso es el mismo
 * montaje sin instantánea en disco (contexto limpio): allí, con el rollup
 * igual de abierto, lo que tiene que haber en pantalla es el esqueleto. Si el
 * primero pasara por cualquier otro motivo —una rejilla que se pinta sola, un
 * selector que casa con el esqueleto—, el segundo pasaría a rojo.
 *
 * Necesita la pila local (`supabase start`) y un usuario sembrado:
 *   E2E_BASE_URL=http://localhost:4321 npx playwright test e2e/library-swr.spec.ts
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Una biblioteca de tamaño creíble: lo bastante grande para que serializarla
 *  y validarla cueste algo, lo bastante chica para no volver lento el test. */
const ROWS = 400;

const POSTER = "/2Nsc9Wa2rzcxk8ZfynOMFFgVvUv.jpg";
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

const libraryRows = () =>
  Array.from({ length: ROWS }, (_, i) => ({
    title_id: uuid(i),
    tmdb_id: 900000 + i,
    kind: "tv",
    name: `Fixture Show ${i}`,
    poster_path: POSTER,
    backdrop_path: null,
    first_air_date: "2024-03-11",
    tmdb_status: "Returning Series",
    genres: ["Drama"],
    network: "AMC",
    vote_average: 8.4,
    favorite: false,
    notify: false,
    stopped: false,
    added_at: "2026-01-01T00:00:00.000Z",
    aired_count: 20,
    watched_count: 7,
    last_watched_at: "2026-01-02T00:00:00.000Z",
    last_aired_datetime: null,
    next_air_datetime: null,
    upcoming_season_number: null,
    upcoming_season_air_date: null,
  }));

async function authenticate(page: Page) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), "password grant should succeed — is the test user seeded?").toBeTruthy();
  const session = await res.json();
  await page.addInitScript(
    ([ref, sess]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess)),
    [PROJECT_REF, session] as const,
  );
}

/** Lo que hay escrito en disco para la cuenta, leído desde la propia página. */
function persisted(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ userId: string; rows: number[] } | null>((resolve) => {
        const open = indexedDB.open("reel-query-cache", 1);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("cache")) return resolve(null);
          const get = db.transaction("cache", "readonly").objectStore("cache").get("user-v1");
          get.onerror = () => resolve(null);
          get.onsuccess = () => {
            const snap = get.result as
              | { userId: string; state: { queries: { state: { data: unknown[] } }[] } }
              | undefined;
            resolve(
              snap ? { userId: snap.userId, rows: snap.state.queries.map((q) => q.state.data.length) } : null,
            );
          };
        };
      }),
  );
}

/** El rollup, contestado solo cuando el test lo suelta. Devuelve el grifo y un
 *  contador de peticiones — la de la segunda visita tiene que SALIR igual, que
 *  es la mitad "revalidate" del trato. */
/* La respuesta del rollup simulado, como la daría PostgREST.
 *
 * Desde que el paginado va en paralelo (lib/paging, fetchPagedParallel) la
 * primera ventana pide el total (`Prefer: count=exact`) y lo lee de
 * `Content-Range`; sin total, encadena ventanas HASTA UNA VACÍA. Un simulacro
 * que devuelve siempre las mismas filas e ignora `offset` no tiene ventana
 * vacía: son peticiones sin fin y un test colgado, no uno rojo. Así que aquí
 * se respeta el `offset` y se da el total, y la cabecera se EXPONE — es una
 * petición entre orígenes y sin `access-control-expose-headers` el navegador
 * no deja leerla, que es volver al caso sin total. */
function fulfillRollup(route: Route) {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? ROWS);
  const rows = libraryRows().slice(offset, offset + limit);
  const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "content-range": `${range}/${ROWS}`,
      "access-control-expose-headers": "content-range",
    },
    body: JSON.stringify(rows),
  });
}

async function gateRollup(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let asked = 0;
  await page.route("**/rpc/rpc_library_rollup*", async (route: Route) => {
    asked += 1;
    await gate;
    await fulfillRollup(route);
  });
  return { release: () => release(), asked: () => asked };
}

/* `.poster` y no `.poster-grid > div`: el esqueleto de carga ES un
   `.poster-grid` con doce huecos dentro (ui/Skeleton), así que contando hijos
   de la rejilla el test daba por pintada la pantalla vacía — y el control de
   abajo, que exige cero, lo cazó. Carátulas de verdad hay donde hay `.poster`. */
const grid = (page: Page) => page.locator(".poster-grid .poster");

test("la segunda visita pinta la biblioteca con el rollup todavía en el aire", async ({ page }) => {
  await authenticate(page);

  // ── primera visita: el rollup contesta y la instantánea se escribe ────────
  await page.route("**/rpc/rpc_library_rollup*", fulfillRollup);
  await page.goto("/shows");
  await expect(grid(page).first()).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(() => persisted(page), { timeout: 15_000, message: "la biblioteca nunca llegó al disco" })
    .not.toBeNull();
  const disco = await persisted(page);
  expect(disco!.rows.some((n) => n === ROWS), `en disco: ${JSON.stringify(disco!.rows)}`).toBe(true);

  // ── segunda visita: el rollup se queda abierto ────────────────────────────
  await page.unroute("**/rpc/rpc_library_rollup*");
  const rollup = await gateRollup(page);
  await page.goto("/shows");

  // Las carátulas no pueden venir de la red: la red sigue sin contestar.
  await expect(grid(page)).toHaveCount(ROWS, { timeout: 20_000 });
  await expect(page.locator(".skeleton")).toHaveCount(0);
  expect(rollup.asked(), "la petición de verdad tiene que salir igual").toBeGreaterThan(0);

  /* Y cuando contesta, sustituye lo pintado sin vaciar la pantalla. Se espera a
     la respuesta ANTES de contar: sin eso la cuenta la daba por buena lo que ya
     estaba en pantalla y esta comprobación no comprobaba nada. */
  const respuesta = page.waitForResponse("**/rpc/rpc_library_rollup*");
  rollup.release();
  await respuesta;
  await expect(grid(page)).toHaveCount(ROWS);
  await expect(page.locator(".skeleton")).toHaveCount(0);
});

test("sin instantánea, la misma pantalla se queda en el esqueleto", async ({ page }) => {
  // El control del test de arriba: mismo montaje, contexto limpio (cada test de
  // Playwright estrena contexto, así que aquí no hay IndexedDB que valga).
  await authenticate(page);
  const rollup = await gateRollup(page);
  await page.goto("/shows");

  await expect(page.locator(".skeleton").first()).toBeVisible({ timeout: 30_000 });
  await expect(grid(page)).toHaveCount(0);

  rollup.release();
  await expect(grid(page)).toHaveCount(ROWS, { timeout: 20_000 });
});
