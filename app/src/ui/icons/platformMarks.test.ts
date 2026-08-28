import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_MARKS } from "@/ui/icons/platformMarks";

/* El techo de `.pick-menu` es un número medido —322 px, lo que pide la opción
   más ancha del desplegable de «en cuál lo juegas»— y la mitad de esa cuenta no
   vive en la hoja de estilos: vive AQUÍ, en la proporción del wordmark de la
   Game Boy Advance, que es el más ancho del catálogo. Nada obligaba a las dos
   mitades a seguir de acuerdo: añadir un logotipo más apaisado que el de la GBA
   —un «SEGA MASTER SYSTEM», por ejemplo— dejaba el techo corto, y lo único que
   se veía era una opción con puntos suspensivos que nadie relaciona con el
   fichero que tocó. Ni los tipos, ni el lint, ni ninguna otra prueba lo miran.

   Lo que se mide en el navegador y no se puede medir aquí es el ANCHO DEL
   NOMBRE: jsdom no tiene tipografías, así que «Game Boy Advance» mediría cero.
   Va de constante, con su fecha, como las pestañas de domain/tabFit.test.ts.
   Todo lo demás —la caja de la opción y la del menú— es aritmética de la hoja
   de estilos, y está escrita con los mismos números que ella. */

/** La altura a la que ui/PlatformPicker pide el dibujo en la lista. */
const ALTO = 15;
/** «Game Boy Advance» a 13,5px/600 con Inter, medido en la app el 28-08-2026. */
const NOMBRE_GBA = 127.45;
/** `.pick-opt`: relleno de 10 a cada lado, dos huecos de 9 y la marca de 13. */
const CAJA_OPCION = 10 * 2 + 9 * 2 + 13;
/** `.pick-menu`: relleno de 6 y borde de 1, a cada lado. */
const CAJA_MENU = 6 * 2 + 1 * 2;

/** Lo que pide la opción de la GBA, de un borde del menú al otro. */
function pideLaGba(): number {
  return ALTO * PLATFORM_MARKS.gba.r + NOMBRE_GBA + CAJA_OPCION + CAJA_MENU;
}

/** El segundo argumento del `min()` del techo, en px.
 *
 *  La hoja se lee del disco y no con `import ... ?raw`, que es como leen sus
 *  fuentes los `*.mirror.test.ts` de domain: vitest corre con `css: false` y
 *  ahí un módulo CSS llega VACÍO —cadena de cero— aunque se pida en crudo, así
 *  que la prueba pasaba en verde sin haber mirado nada. Y la ruta sale del
 *  directorio raíz de vitest, que es este `app/`, y no de `import.meta.url`:
 *  bajo vitest esa URL es la del servidor de Vite, `http://…`, y `fileURLToPath`
 *  la rechaza. */
function techoDelMenu(): number {
  const css = readFileSync(resolve(process.cwd(), "src/styles/marquee.css"), "utf8");
  const bloque = css.slice(css.indexOf(".pick-menu {"));
  const m = /max-width:\s*min\(calc\(100vw - 32px\),\s*([\d.]+)px\)/.exec(bloque);
  if (!m) throw new Error("no encuentro el max-width de .pick-menu en marquee.css");
  return Number(m[1]);
}

/** La marca más apaisada del catálogo: `r` es ancho ÷ alto. */
function masApaisada(): { clave: string; r: number } {
  return Object.entries(PLATFORM_MARKS)
    .map(([clave, m]) => ({ clave, r: m.r }))
    .reduce((a, b) => (b.r > a.r ? b : a));
}

describe("el techo del desplegable y el logotipo más ancho", () => {
  it("la Game Boy Advance sigue siendo el logotipo más ancho", () => {
    /* Si esto falla, el techo de marquee.css se ha quedado sin dueño: hay que
       medir en el navegador la opción de la marca nueva y poner ese número. */
    expect(masApaisada().clave).toBe("gba");
  });

  it("el techo deja pasar entera la opción de la Game Boy Advance", () => {
    expect(pideLaGba()).toBeCloseTo(321.2, 1);
    expect(techoDelMenu()).toBeGreaterThanOrEqual(pideLaGba());
  });

  it("y no sobra ni un píxel: el techo es esa medida redondeada hacia arriba", () => {
    /* Por encima es hueco que no pisa nadie —era el caso de los 340 de antes— y
       por debajo la GBA sale con puntos suspensivos. */
    expect(techoDelMenu()).toBe(Math.ceil(pideLaGba()));
  });
});
