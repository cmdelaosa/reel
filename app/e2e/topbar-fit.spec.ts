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

   LO QUE NO CAZA. Mide UN instante —el primero en que la barra está pintada—,
   que es cuando están tanto la barra como los esqueletos, o sea las dos formas
   de desbordar que se han visto. Un ancho de más que apareciera solo DESPUÉS,
   con los datos ya puestos, se le escaparía: para eso haría falta muestrear
   toda la carga, y eso es una prueba más lenta y con más motivos para parpadear
   de los que este ancho justifica.

   Env (por defecto, la pila local):
     E2E_SUPABASE_URL / E2E_ANON_KEY / E2E_EMAIL / E2E_PASSWORD */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Inicia sesión y deja el modo puesto ANTES del primer pintado: el conmutador
 *  lee localStorage al importar, así que ponerlo después mediría la barra del
 *  modo anterior.
 *
 *  El idioma va por el mismo camino y por el mismo motivo: i18n.ts lo lee una
 *  vez, y la app entera se pinta con el que hubiera al arrancar. */
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
      // En español. Es el idioma en el que las cosas no caben: "Lanzamientos"
      // contra "Releases", "Esta noche" contra "Tonight". El 26-08-2026 la
      // barra de escritorio pedía 1385px en español y 1300 en inglés — las dos
      // por encima de la pantalla, pero medir solo en inglés habría dejado el
      // desbordamiento a un tercio de su tamaño real.
      window.localStorage.setItem("reel.settings", JSON.stringify({ language: "es" }));
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
   contempla. Entre los dos cae todo el teléfono.

   Y 1280, que es el escritorio y NO estaba aquí — por eso el desbordamiento del
   26-08-2026 vivió tranquilo: por debajo de 1024px el nav de pestañas está
   oculto (`.mq-tabs { display: none }`), así que las seis pestañas del modo
   Juegos, que son las que rompían la barra, no existían en ninguna de las dos
   medidas que este fichero tomaba. Una prueba de que la barra cabe que solo
   mira los anchos donde la barra no lleva el nav no prueba gran cosa. */
const ANCHOS = [1280, 390, 320] as const;

/** Por debajo de esto manda el dock; por encima, el nav de la barra. */
const ESCRITORIO = 1024;

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
          avatar: Math.ceil(document.querySelector(".mq-avatar")?.getBoundingClientRect().right ?? 0),
        }));

        expect(
          medida.scrollWidth,
          `la página pide ${medida.scrollWidth}px en ${medida.clientWidth} — la barra llega a ${medida.barra}`,
        ).toBeLessThanOrEqual(medida.clientWidth);

        /* Y el último control de la barra, dentro. La página puede caber y el
           avatar estar fuera igualmente: es lo que pasaba en escritorio, donde
           el nav empujaba la fila de acciones hasta right:1386 sobre 1269 de
           pantalla. scrollWidth lo cazaba de rebote; esto lo dice por su
           nombre, que es la mitad del valor de una prueba cuando falla. */
        expect(
          medida.avatar,
          `el avatar llega a ${medida.avatar}px sobre ${medida.clientWidth} de pantalla`,
        ).toBeLessThanOrEqual(medida.clientWidth);
      });

      /* El dock es la otra mitad del mismo problema, y tiene su propia forma de
         romperse: no empuja la página —es `position: fixed`, así que no cuenta
         para scrollWidth— sino que se sale de su propia píldora por el lado
         derecho. Invisible para la comprobación de arriba, y sin embargo es
         una pestaña que no se puede pulsar.

         Medido el 26-08-2026 en modo Juegos a 320px y en español: el dock pedía
         308px de contenido para un carril de 294, y "Amigos" aterrizaba en
         right:321 con 320 de pantalla. Seis pestañas en un sitio calibrado para
         cinco. */
      if (ancho < ESCRITORIO) {
        test(`el dock cabe en modo ${medium}`, async ({ page }) => {
          await authenticate(page, medium);
          await page.goto(ruta);
          await expect(page.locator(".mq-dock")).toBeVisible();

          const dock = await page.evaluate(() => {
            const d = document.querySelector(".mq-dock") as HTMLElement;
            const botones = [...d.querySelectorAll<HTMLElement>(".mq-dockbtn")].map((b) => ({
              nombre: b.getAttribute("title") ?? "",
              derecha: Math.ceil(b.getBoundingClientRect().right),
              ancho: Math.round(b.getBoundingClientRect().width),
              alto: Math.round(b.getBoundingClientRect().height),
            }));
            return { clientWidth: d.clientWidth, scrollWidth: d.scrollWidth, pantalla: document.documentElement.clientWidth, botones };
          });

          expect(
            dock.scrollWidth,
            `el dock pide ${dock.scrollWidth}px para un carril de ${dock.clientWidth}`,
          ).toBeLessThanOrEqual(dock.clientWidth);

          for (const b of dock.botones) {
            expect(b.derecha, `"${b.nombre}" llega a ${b.derecha}px sobre ${dock.pantalla}`).toBeLessThanOrEqual(dock.pantalla);
            /* Y de paso el mínimo táctil, que es de lo que se pagaba el sitio
               antes: los botones habían bajado a 35×41px a base de recortarles
               el padding para que cupiera una pestaña más. */
            expect(Math.min(b.ancho, b.alto), `"${b.nombre}" mide ${b.ancho}×${b.alto}`).toBeGreaterThanOrEqual(44);
          }
        });
      }
    }
  });
}
