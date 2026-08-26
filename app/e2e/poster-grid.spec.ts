import { test, expect, type Page } from "@playwright/test";

/* Nunca una carátula sola ocupando el ancho del teléfono.

   `.poster-grid` es la rejilla de la biblioteca de los tres medios, de Explorar,
   de una colección y del esqueleto de carga. Su mínimo es `--pw` (158px), y con
   `auto-fill` a secas eso significaba que en cuanto la anchura útil bajaba de
   dos columnas más el hueco —336px, o sea cualquier teléfono de 360 para
   abajo— la rejilla se caía a UNA columna. Y una columna de carátulas en
   proporción 2:3 no es una rejilla: es un cartel a pantalla completa por
   título, con scroll para ver el siguiente.

   Lo que se comprueba es el suelo, no el número exacto: cuántas columnas caben
   en un escritorio es cosa de `--pw` y de la densidad, y clavarlo aquí sería
   convertir una preferencia en un contrato. Dos es el suelo.

   Hermética de verdad: no necesita sesión ni datos. Mide la rejilla sobre un
   elemento de prueba en /kit, que es la guía de estilo y es pública — así la
   prueba no depende de que la biblioteca tenga contenido, que es justo lo que
   la haría parpadear. */

/** El ancho más estrecho que la app admite, el iPhone corriente, y el salto a
 *  tableta. Por debajo de 320 no hay teléfono. */
const ANCHOS = [320, 360, 390, 414, 768] as const;

/** Cuenta las columnas que el navegador ha resuelto de verdad, no las que la
 *  declaración pide: `grid-template-columns` computado devuelve la lista de
 *  pistas ya en píxeles. */
async function columnas(page: Page, clase: string): Promise<{ n: number; pistas: string; ancho: number }> {
  return page.evaluate((cls) => {
    /* Dentro de .mq-main y de ningún otro sitio: la anchura que hay que medir
       es la que la rejilla tiene de verdad en la página, con el relleno del
       contenedor ya descontado. Cayendo a <body> se mediría el ancho completo
       del viewport —hasta 32px de más— y la comprobación pasaría a ser más
       permisiva que la realidad, sin decirlo. Mejor que reviente. */
    const host = document.querySelector(".mq-main");
    if (!host) throw new Error("no hay .mq-main: la página no ha montado");
    const probe = document.createElement("div");
    probe.className = cls;
    // Ocho hijos: más que columnas quepan en cualquiera de los anchos de arriba,
    // para que auto-fill no se quede corto por falta de contenido.
    for (let i = 0; i < 8; i++) {
      const c = document.createElement("div");
      c.style.cssText = "aspect-ratio:2/3";
      probe.appendChild(c);
    }
    host.appendChild(probe);
    const pistas = getComputedStyle(probe).gridTemplateColumns;
    const ancho = Math.round(probe.getBoundingClientRect().width);
    probe.remove();
    return { n: pistas.split(/\s+/).filter(Boolean).length, pistas, ancho };
  }, clase);
}

for (const ancho of ANCHOS) {
  test.describe(`a ${ancho}px`, () => {
    test.use({ viewport: { width: ancho, height: 844 } });

    for (const clase of ["poster-grid", "fr-grid"] as const) {
      test(`.${clase} nunca baja de dos columnas`, async ({ page }) => {
        await page.goto("/kit");
        await expect(page.locator(".mq-main")).toBeVisible();

        const { n, pistas, ancho: anchoRejilla } = await columnas(page, clase);

        expect(
          n,
          `.${clase} resolvió ${n} columna(s) en ${anchoRejilla}px: ${pistas}`,
        ).toBeGreaterThanOrEqual(2);
      });
    }
  });
}
