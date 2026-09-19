import { test, expect, type Page, type Route } from "@playwright/test";

/* La rejilla de la biblioteca se monta por tandas (ui/GrowingList).
 *
 * Lo que se comprueba es lo que montar por tandas podía romper, no la tanda en
 * sí —cuántas entran es un número que puede cambiar—:
 *   - que al hacer scroll se llega a TODA la biblioteca, y que el contador del
 *     cubo la cuenta entera desde el principio;
 *   - que abrir y cerrar una ficha deja la página donde estaba (la ficha abre
 *     encima, y una tanda reiniciada acortaría la página y te subiría);
 *   - que el tabulador no se queda sin tarjetas al final de lo montado;
 *   - que en un teléfono no aparece scroll horizontal (un desbordamiento saca
 *     el dock del área táctil).
 *
 * El rollup se simula con filas de mentira, como en library-swr.spec.ts.
 * Necesita la pila local (`supabase start`) y un usuario sembrado:
 *   E2E_BASE_URL=http://localhost:4321 npx playwright test e2e/library-grid-batches.spec.ts
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Varias tandas: con una sola no habría nada que comprobar. */
const ROWS = 300;

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

/** El rollup como lo daría PostgREST: respeta `offset` y da el total (ver el
 *  porqué en library-swr.spec.ts, fulfillRollup). */
function fulfillRollup(route: Route) {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? ROWS);
  const rows = libraryRows().slice(offset, offset + limit);
  const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": `${range}/${ROWS}`, "access-control-expose-headers": "content-range" },
    body: JSON.stringify(rows),
  });
}

const grid = (page: Page) => page.locator(".poster-grid .poster");

async function openLibrary(page: Page) {
  await authenticate(page);
  await page.route("**/rpc/rpc_library_rollup*", fulfillRollup);
  await page.goto("/shows");
  await expect(grid(page).first()).toBeVisible({ timeout: 30_000 });
}

test("monta una tanda, cuenta la biblioteca entera y crece hasta el final al hacer scroll", async ({ page }) => {
  await openLibrary(page);

  const first = await grid(page).count();
  expect(first, "la primera tanda tiene que quedarse corta: si no, no hay tandas").toBeLessThan(ROWS);
  // El contador del cubo es de la lista entera, no de lo montado.
  await expect(page.locator(".shows-buckets .chip-active")).toContainText(String(ROWS));

  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      return grid(page).count();
    }, { timeout: 20_000 })
    .toBe(ROWS);
  // Todo montado: el centinela se va.
  await expect(page.locator(".grid-sentinel")).toHaveCount(0);
});

test("abrir y cerrar una ficha deja la página donde estaba", async ({ page }) => {
  await openLibrary(page);

  // Unas cuantas tandas hacia abajo, y quieto a media página.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.scrollBy(0, -600));
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.scrollY);
  const mounted = await grid(page).count();
  expect(before).toBeGreaterThan(1000);

  // Una tarjeta entera a la vista, la que alguien pulsaría sin mover nada.
  const label = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".poster-grid .poster")].find((p) => {
      const r = p.getBoundingClientRect();
      return r.top >= 80 && r.bottom <= window.innerHeight;
    });
    return el?.getAttribute("aria-label") ?? null;
  });
  expect(label, "no hay carátula entera a la vista").not.toBeNull();
  await page.locator(`.poster-grid .poster[aria-label="${label}"]`).click();
  await expect(page).toHaveURL(/[?&]title=\d+/);

  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]title=/);

  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
  expect(await grid(page).count()).toBeGreaterThanOrEqual(mounted);
});

test("el tabulador no se queda sin tarjetas al final de lo montado", async ({ page }) => {
  await openLibrary(page);
  const first = await grid(page).count();

  // Enfocar la última montada la desplaza a la vista, y eso acerca el centinela.
  await grid(page).last().focus();
  await expect.poll(() => grid(page).count()).toBeGreaterThan(first);
  // Y el foco sigue en una carátula, no se ha ido a ninguna parte.
  expect(await page.evaluate(() => document.activeElement?.classList.contains("poster"))).toBe(true);
});

test.describe("en un teléfono", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("montar tandas no abre scroll horizontal", async ({ page }) => {
    await openLibrary(page);
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        return grid(page).count();
      }, { timeout: 20_000 })
      .toBe(ROWS);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});
