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
/** Y en el botón, que lo pide un píxel más grande. */
const ALTO_BOTON = 16;
/** «Game Boy Advance» a 13,5px/600 con Inter, medido en la app el 28-08-2026. */
const NOMBRE_GBA = 127.45;
/** El mismo nombre a 13,5px/650, que es el peso del botón. Medido igual. */
const NOMBRE_GBA_BOTON = 127.94;
/** `.pick-opt`: relleno de 10 a cada lado, dos huecos de 9 y la marca de 13. */
const CAJA_OPCION = 10 * 2 + 9 * 2 + 13;
/** `.pick-menu`: relleno de 6 y borde de 1, a cada lado. */
const CAJA_MENU = 6 * 2 + 1 * 2;
/** `.pick`: relleno de 12 y borde de 1 a cada lado, dos huecos de 9 y el galón de 15. */
const CAJA_BOTON = 12 * 2 + 1 * 2 + 9 * 2 + 15;

/** Lo que pide la opción de la GBA, de un borde del menú al otro. */
function pideLaGba(): number {
  return ALTO * PLATFORM_MARKS.gba.r + NOMBRE_GBA + CAJA_OPCION + CAJA_MENU;
}

/** Y lo que pide en el botón, que es donde el ancho está FIJADO a esa medida:
 *  el desplegable no cambia de tamaño al elegir, así que el número tiene que
 *  ser el del nombre más largo que puede caer ahí — el de la GBA. */
function pideLaGbaEnElBoton(): number {
  return ALTO_BOTON * PLATFORM_MARKS.gba.r + NOMBRE_GBA_BOTON + CAJA_BOTON;
}

/** El cuerpo de una regla de la hoja, para no buscar a ciegas en 131 kB.
 *
 *  Se busca con el salto de línea delante, y eso no es maña: `.pick {` a secas
 *  casa dentro de `.game-plat .pick {`, que está antes en el fichero, así que
 *  la prueba del botón leía la regla equivocada y fallaba diciendo que a `.pick`
 *  le faltaba un relleno que sí tiene. */
function regla(selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`no encuentro la regla ${selector} en marquee.css`);
  const fin = css.indexOf("}", i);
  return css.slice(i, fin);
}

/** El ancho fijo del botón, en px. La frontera de delante es por lo mismo que
 *  el salto de línea de `regla`: `width:` casa dentro de `min-width:`, y un
 *  `min-width` en píxeles escrito antes se leería como si fuera el ancho. */
function anchoDelBoton(): number {
  const m = /[;{\s]width:\s*([\d.]+)px/.exec(regla(".game-plat .pick"));
  if (!m) throw new Error("no encuentro el width de .game-plat .pick en marquee.css");
  return Number(m[1]);
}

/** Lo que mide el menú, que ya no es un número suyo: hereda el del botón. */
function anchoDelMenu(): number {
  const cuerpo = regla(".pick-menu");
  if (!/[;{\s]width:\s*100%/.test(cuerpo)) {
    throw new Error("el .pick-menu ya no mide el 100% de su botón; la cuenta de aquí no vale");
  }
  if (/max-width:/.test(cuerpo)) {
    throw new Error("el .pick-menu ha vuelto a tener techo propio; hay que decidir cuál manda");
  }
  return anchoDelBoton();
}

/** La marca más apaisada del catálogo: `r` es ancho ÷ alto. */
function masApaisada(): { clave: string; r: number } {
  return Object.entries(PLATFORM_MARKS)
    .map(([clave, m]) => ({ clave, r: m.r }))
    .reduce((a, b) => (b.r > a.r ? b : a));
}

describe("el ancho del desplegable y el logotipo más ancho", () => {
  it("la Game Boy Advance sigue siendo el logotipo más ancho", () => {
    /* Si esto falla, el 325 de marquee.css se ha quedado sin dueño: hay que
       medir en el navegador el botón con la marca nueva y poner ese número. */
    expect(masApaisada().clave).toBe("gba");
  });

  it("la caja de la que sale la cuenta sigue siendo la que dicen la hoja y el componente", () => {
    expect(regla(".pick-opt")).toContain("padding: 7px 10px");
    expect(regla(".pick-opt")).toContain("gap: 9px");
    expect(regla(".pick-menu")).toContain("padding: 6px");
    // La altura del dibujo y el tamaño de la marca de selección, en la lista.
    expect(picker).toContain("<PlatformMarkIcon model={p} size={15} />");
    expect(picker).toContain("<Check size={13}");
    // Y la caja del botón, que es la otra cuenta.
    expect(regla(".pick")).toContain("gap: 9px");
    expect(regla(".pick")).toContain("padding: 0 12px");
    expect(regla(".pick")).toContain("border: 1px solid");
    expect(picker).toContain("<PlatformMarkIcon model={puesta} size={16} />");
    expect(picker).toContain("<ChevronDown size={15}");
  });


  it("el botón está fijado justo en lo que pide la Game Boy Advance", () => {
    /* Si esto falla es que la cuenta del botón se movió —otra altura de dibujo,
       otro relleno, otro galón— y el ancho fijo se quedó corto: el nombre más
       largo empezaría a salir con puntos suspensivos SIEMPRE, en todas las
       fichas, que es lo que un ancho fijo hace cuando se queda pequeño. */
    expect(pideLaGbaEnElBoton()).toBeCloseTo(324.3, 1);
    expect(anchoDelBoton()).toBe(Math.ceil(pideLaGbaEnElBoton()));
  });

  it("el menú mide lo mismo que el botón, y por herencia y no por copia", () => {
    /* `anchoDelMenu` revienta si la hoja deja de decir `width: 100%` o si le
       vuelve a poner un techo propio: los dos anchos tienen que seguir siendo
       el mismo número, que es lo que hace que el menú caiga clavado debajo. */
    expect(anchoDelMenu()).toBe(anchoDelBoton());
  });

  it("y la opción más ancha cabe dentro de ese ancho, sin recortarse", () => {
    /* La lista mide su opción más larga —la de la GBA, 321,2— y ahora el ancho
       lo manda el botón: si un día la opción pidiera más que él, el nombre
       saldría con puntos suspensivos en todas las fichas a la vez. */
    expect(pideLaGba()).toBeCloseTo(321.2, 1);
    expect(anchoDelMenu()).toBeGreaterThanOrEqual(pideLaGba());
  });
});
