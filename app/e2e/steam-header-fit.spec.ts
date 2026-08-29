import { test, expect, type Page } from "@playwright/test";

/* La cabecera de la cuenta de Steam cabe en un teléfono.

   Misma familia que topbar-fit.spec.ts y por el mismo motivo: en un móvil un
   elemento más ancho que la pantalla no saca barra de desplazamiento, ENCOGE la
   página entera, y con ella el dock flotante se va fuera del área táctil. El
   síntoma —«no me responde el botón de abajo»— no se parece en nada a la causa
   —«sobran 30px en una fila de arriba»—.

   Lo que se rompía aquí (medido el 29-08-2026, 375x812): la fila de la cuenta
   conectada envuelve, pero la pareja de botones que lleva dentro —"Mirar mi
   biblioteca de Steam" y "Desconectar"— iba en un flex SIN wrap, así que los dos
   juntos pedían 405px sobre 375 de pantalla (440 en español, con un steam_id de
   los largos).

   Hermética: no toca datos. El estado "conectada" se finge interceptando la
   única lectura que lo decide (profiles.steam_id), porque el usuario sembrado
   del CI no tiene cuenta de Steam enlazada y la fila que aquí se mide solo
   existe cuando la tiene. */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** El id más largo que Steam reparte (17 dígitos): es el que se pinta debajo de
 *  "Conectada" y el que decide cuánto mide la mitad izquierda de la fila. */
const STEAM_ID = "76561199999999999";

async function authenticate(page: Page) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), "password grant should succeed — is the test user seeded?").toBeTruthy();
  const session = await res.json();
  await page.addInitScript(
    ([ref, sess]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
      window.localStorage.setItem("reel.medium", "game");
      // En español, que es el idioma en el que las cosas no caben.
      window.localStorage.setItem("reel.settings", JSON.stringify({ language: "es" }));
    },
    [PROJECT_REF, session] as const,
  );
}

/** Finge la cuenta enlazada. Solo la lectura de steam_id: el resto de consultas
 *  a profiles —el perfil propio, los amigos— siguen yendo a la pila local. */
async function fingirCuentaEnlazada(page: Page) {
  await page.route(
    (url) =>
      url.pathname.endsWith("/rest/v1/profiles") &&
      url.searchParams.get("select") === "steam_id,steam_linked_at",
    (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steam_id: STEAM_ID, steam_linked_at: "2026-08-01T00:00:00Z" }),
      }),
  );
}

/* 375 es el iPhone corriente estrecho y 320 el más angosto que la hoja de
   estilos contempla. Entre los dos cae todo el teléfono. */
for (const ancho of [375, 320] as const) {
  test(`la cabecera de la cuenta de Steam cabe a ${ancho}px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 });
    await authenticate(page);
    await fingirCuentaEnlazada(page);
    await page.goto("/games/steam");

    // Con la fila de la cuenta pintada: medir antes es medir la pantalla vacía.
    await expect(page.getByText(STEAM_ID)).toBeVisible();

    const medida = await page.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const desbordan = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => Math.ceil(el.getBoundingClientRect().right) > ancho)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 90));
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: ancho,
        desbordan: desbordan.slice(0, 5),
      };
    });

    expect(
      medida.scrollWidth,
      `la página pide ${medida.scrollWidth}px en ${medida.clientWidth} — se salen: ${medida.desbordan.join(" | ")}`,
    ).toBeLessThanOrEqual(medida.clientWidth);
  });
}
