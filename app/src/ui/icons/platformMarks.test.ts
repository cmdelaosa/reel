import { describe, expect, it } from "vitest";
import css from "@/styles/marquee.css?raw";
import picker from "@/ui/PlatformPicker.tsx?raw";
import { PLATFORM_MARKS } from "@/ui/icons/platformMarks";

/* El techo de `.pick-menu` —322 px, lo que pide la opción más ancha del
   desplegable de «en cuál lo juegas»— es un número MEDIDO, y la mitad de la
   cuenta que lo sostiene no vive en la hoja de estilos: vive aquí, en la
   proporción del wordmark de la Game Boy Advance, que es el más apaisado del
   catálogo. Nada obligaba a las dos mitades a seguir de acuerdo: añadir un
   logotipo más ancho que el suyo —un «SEGA MASTER SYSTEM», por ejemplo— dejaba
   el techo corto, y lo único que se veía era una opción con puntos suspensivos
   que nadie relaciona con el fichero que tocó. Ni los tipos, ni el lint, ni
   ninguna otra prueba miran eso.

   Lo único que no se puede medir aquí es el ANCHO DEL NOMBRE: jsdom no tiene
   tipografías, así que «Game Boy Advance» mediría cero. Ese va de constante,
   con su fecha, como los anchos de pestaña de domain/tabFit.test.ts. Todo lo
   demás es aritmética de la caja, y sus números son COPIAS de la hoja de
   estilos y del componente — así que la prueba de en medio comprueba que
   siguen siendo copias, porque una cuenta correcta sobre un relleno que ya
   cambió es un verde que no vale nada.

   La hoja llega por `?raw` como en los `*.mirror.test.ts` de domain, y eso pide
   una línea en vite.config: vitest sustituye por vacío TODO lo que huela a CSS
   —también en crudo—, así que sin el `css: { include }` esta prueba pasaría en
   verde sin haber leído nada. */

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

/** El cuerpo de una regla de la hoja, para no buscar a ciegas en 131 kB. */
function regla(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`no encuentro la regla ${selector} en marquee.css`);
  const fin = css.indexOf("}", i);
  return css.slice(i, fin);
}

/** El segundo argumento del `min()` del techo, en px. */
function techoDelMenu(): number {
  const m = /max-width:\s*min\(calc\(100vw - 32px\),\s*([\d.]+)px\)/.exec(regla(".pick-menu"));
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

  it("la caja de la que sale la cuenta sigue siendo la que dicen la hoja y el componente", () => {
    expect(regla(".pick-opt")).toContain("padding: 7px 10px");
    expect(regla(".pick-opt")).toContain("gap: 9px");
    expect(regla(".pick-menu")).toContain("padding: 6px");
    // La altura del dibujo y el tamaño de la marca de selección, en la lista.
    expect(picker).toContain("<PlatformMarkIcon model={p} size={15} />");
    expect(picker).toContain("<Check size={13}");
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
