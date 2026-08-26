import { test, expect, type Page } from "@playwright/test";

/* La barra superior cabe en un teléfono. En los TRES modos.

   Esto no es una prueba de estética. En un móvil, una barra que no cabe no se
   recorta ni saca barra de desplazamiento: el navegador ENCOGE la página entera
   para que quepa —0,87 en un iPhone de 390— y con ella se lleva el dock
   flotante fuera del área táctil. El síntoma que produce no se parece en nada a
   la causa: un botón del menú de abajo deja de poder pulsarse, sin que se vea
   nada roto por ningún lado. Fue lo que tumbó a watchlist-nav el 25-08-2026, y
   costó una tarde llegar desde «el dock no responde» hasta «sobran 59px arriba».

   Y va por modo porque el fallo se esconde justo ahí: la etiqueta encendida del
   conmutador mide lo que mida su palabra, así que con "TV" cabía por los pelos
   y con "Cine" o "Juegos" no. Una prueba que entrara solo en series —como hacen
   todas las demás— habría dado verde sobre dos modos rotos.

   Hermética: no toca datos, solo mide. Necesita la pila local y el usuario
   sembrado, como el resto.

   Env (por defecto, la pila local):
     E2E_SUPABASE_URL / E2E_ANON_KEY / E2E_EMAIL / E2E_PASSWORD */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Inicia sesión y deja el modo puesto ANTES del primer pintado: el conmutador
 *  lee localStorage al importar, así que ponerlo después mediría la barra del
 *  modo anterior. */
async function authenticate(page: Page, medium: string) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), "password grant should succeed — is the test user seeded?").toBeTruthy();
  const session = await res.json();
  await page.addInitScript(
    ([ref, sess, m]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
      window.localStorage.setItem("reel.medium", m as string);
    },
    [PROJECT_REF, session, medium] as const,
  );
}

const MODOS = [
  { medium: "tv", ruta: "/tonight" },
  { medium: "movie", ruta: "/movies/tonight" },
  { medium: "game", ruta: "/games/tonight" },
] as const;

/* 390 es el iPhone corriente y 320 el más estrecho que la hoja de estilos
   contempla (su corte de 359px). Entre los dos cae todo lo demás. */
const ANCHOS = [390, 320] as const;

for (const ancho of ANCHOS) {
  test.describe(`a ${ancho}px`, () => {
    test.use({ viewport: { width: ancho, height: 844 } });

    for (const { medium, ruta } of MODOS) {
      test(`la barra cabe en modo ${medium}`, async ({ page }) => {
        await authenticate(page, medium);
        await page.goto(ruta);
        // Con la barra pintada y su etiqueta puesta: medir antes es medir otra
        // cosa. El conmutador es lo último que se ensancha.
        await expect(page.locator(".mq-medium-seg.on")).toBeVisible();

        const medida = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          barra: Math.ceil(document.querySelector(".mq-top-inner")?.getBoundingClientRect().right ?? 0),
        }));

        expect(
          medida.scrollWidth,
          `la página pide ${medida.scrollWidth}px en ${medida.clientWidth} — la barra llega a ${medida.barra}`,
        ).toBeLessThanOrEqual(medida.clientWidth);
      });
    }
  });
}
