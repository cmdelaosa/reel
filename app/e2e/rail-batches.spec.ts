import { test, expect, type Page, type Route } from "@playwright/test";

/* Los carruseles se montan por tandas (ui/Rail + ui/GrowingList en eje x).
 *
 * Como en library-grid-batches.spec.ts, se comprueba lo que montar por tandas
 * podía romper, no el tamaño de la tanda:
 *   - que la fila llega a TODA la lista con su propio scroll;
 *   - que la flecha derecha sigue avanzando aunque la tanda siguiente no esté
 *     montada todavía, hasta el final;
 *   - que el tabulador no se queda sin tarjetas al final de lo montado;
 *   - que en un teléfono no aparece scroll horizontal de PÁGINA (un
 *     desbordamiento saca el dock del área táctil).
 *
 * "Tu lista" de /movies/tonight: sin tope, con 300 películas de mentira.
 * Necesita la pila local (`supabase start`) y un usuario sembrado:
 *   E2E_BASE_URL=http://localhost:4321 npx playwright test e2e/rail-batches.spec.ts
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

const ROWS = 300;
const POSTER = "/2Nsc9Wa2rzcxk8ZfynOMFFgVvUv.jpg";
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

// Pendientes (watched_count 0) y todas del mismo año: el orden no importa aquí.
const movieRows = () =>
  Array.from({ length: ROWS }, (_, i) => ({
    title_id: uuid(i),
    tmdb_id: 900000 + i,
    kind: "movie",
    name: `Fixture Movie ${i}`,
    poster_path: POSTER,
    backdrop_path: null,
    first_air_date: "2024-03-11",
    tmdb_status: "Released",
    genres: ["Drama"],
    network: null,
    vote_average: 7.4,
    favorite: false,
    notify: false,
    stopped: false,
    added_at: "2026-01-01T00:00:00.000Z",
    aired_count: 1,
    watched_count: 0,
    last_watched_at: null,
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

/** El rollup de cine como lo daría PostgREST (ver library-swr.spec.ts). Las
 *  otras lecturas del medio (series, juegos) salen vacías. */
function fulfillRollup(route: Route) {
  const kind = (route.request().postDataJSON() ?? {}).p_kind;
  const all = kind === "movie" ? movieRows() : [];
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? all.length);
  const rows = all.slice(offset, offset + limit);
  const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": `${range}/${all.length}`, "access-control-expose-headers": "content-range" },
    body: JSON.stringify(rows),
  });
}

const rail = (page: Page) => page.locator(".rail").first();
const cards = (page: Page) => rail(page).locator(".poster");

async function openTonight(page: Page) {
  await authenticate(page);
  await page.route("**/rpc/rpc_library_rollup*", fulfillRollup);
  await page.goto("/movies/tonight");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

test("monta una tanda y la fila crece hasta el final con su propio scroll", async ({ page }) => {
  await openTonight(page);
  // El héroe se lleva una: la fila tiene ROWS - 1.
  const total = ROWS - 1;
  const first = await cards(page).count();
  expect(first, "la primera tanda tiene que quedarse corta: si no, no hay tandas").toBeLessThan(total);

  await expect
    .poll(async () => {
      await rail(page).evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      return cards(page).count();
    }, { timeout: 20_000 })
    .toBe(total);
  await expect(rail(page).locator(".grid-sentinel")).toHaveCount(0);
  // Crecer en horizontal no alarga la página.
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0);
});

test("la flecha derecha avanza más allá de la primera tanda", async ({ page }) => {
  await openTonight(page);
  const first = await cards(page).count();
  const right = page.locator(".rail-wrap").first().locator(".rail-arrow").nth(1);

  // Pulsando solo la flecha, sin tocar el scroll a mano: la tanda siguiente
  // entra antes de que la flecha se quede sin sitio adonde ir.
  await expect
    .poll(async () => {
      if (await right.isEnabled()) await right.click();
      await page.waitForTimeout(250);
      return cards(page).count();
    }, { timeout: 30_000 })
    .toBeGreaterThan(first * 2);
  await expect(right).toBeEnabled();
});

test("el tabulador no se queda sin tarjetas al final de lo montado", async ({ page }) => {
  await openTonight(page);
  const first = await cards(page).count();

  // Enfocar la última montada desplaza la fila hasta ella, y eso acerca el centinela.
  await cards(page).last().focus();
  await expect.poll(() => cards(page).count()).toBeGreaterThan(first);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("poster"))).toBe(true);
  // Y el siguiente Tab cae en la tarjeta siguiente, que ya existe.
  const before = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  await page.keyboard.press("Tab");
  const after = await page.evaluate(() => ({
    label: document.activeElement?.getAttribute("aria-label"),
    poster: document.activeElement?.classList.contains("poster") ?? false,
  }));
  expect(after.poster).toBe(true);
  expect(after.label).not.toBe(before);
});

test.describe("en un teléfono", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("montar tandas en la fila no abre scroll horizontal de página", async ({ page }) => {
    await openTonight(page);
    await expect
      .poll(async () => {
        await rail(page).evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        return cards(page).count();
      }, { timeout: 20_000 })
      .toBe(ROWS - 1);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});
