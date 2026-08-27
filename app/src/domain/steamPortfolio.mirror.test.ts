import { describe, expect, it } from "vitest";
import specSource from "@/domain/steamPortfolio.ts?raw";
import marketSource from "../../../supabase/functions/steam-market/index.ts?raw";

/* `steamPortfolio.ts` es la especificación; `steam-market` la copia a mano
   porque corre en Deno y no puede importar de app/ — el mismo arreglo que
   airPairing, y por el mismo motivo.

   Lo que decide este bloque es DINERO y FECHAS: cómo se lee "1 234,56 руб." y en
   qué año cae una compra que Steam escribió como "20 dic". Si las dos copias se
   separan, no sale una pantalla ligeramente distinta: sale un total distinto
   según lo calcule la app al pintar o la ingesta al escribir, y las dos parecen
   correctas por separado.

   Por eso se comparan los BYTES y no regla por regla: no hay nada aquí que
   merezca la pena parafrasear, y la igualdad literal es el control más barato
   que existe. Las dos copias se empalman entre los mismos dos marcadores. */

const SPEC = "app/src/domain/steamPortfolio.ts";
const MIRROR = "supabase/functions/steam-market/index.ts";

const sources: Record<string, string> = {
  [SPEC]: specSource,
  [MIRROR]: marketSource,
};

const OPEN = "// ── steam money and dates ";
const CLOSE = "// ── end steam money and dates ";

/** El bloque marcado, con los espacios del final normalizados (los editores
 *  difieren, la intención no). Revienta en vez de devolver vacío: un marcador
 *  movido o renombrado tiene que fallar a gritos, no comparar nada con nada. */
function block(src: string, file: string): string {
  const from = src.indexOf(OPEN);
  const to = src.indexOf(CLOSE);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`marcadores de steam money and dates no encontrados en ${file}`);
  }
  return src
    .slice(from, src.indexOf("\n", to) + 1)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
}

describe("el bloque de dinero y fechas está espejado byte a byte", () => {
  it("la especificación trae el bloque y no está vacío", () => {
    const spec = block(sources[SPEC], SPEC);
    expect(spec.length).toBeGreaterThan(500);
    expect(spec).toContain("export function priceCents");
    expect(spec).toContain("export function datesWithYear");
  });

  it(`${MIRROR} lo copia literal`, () => {
    expect(block(sources[MIRROR], MIRROR)).toBe(block(sources[SPEC], SPEC));
  });

  it("ninguna copia trae un byte NUL", () => {
    // Pasó al escribir este fichero: un NUL literal se coló como separador de
    // la clave del mapa. Funciona, y deja el fichero ilegible para grep y para
    // diff — o sea, invisible en la revisión que tendría que haberlo cazado.
    for (const [file, src] of Object.entries(sources)) {
      expect(src.includes("\u0000"), `${file} trae un NUL`).toBe(false);
    }
  });
});
