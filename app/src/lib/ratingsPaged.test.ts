import { describe, expect, it } from "vitest";

/* La guarda de las lecturas de `ratings`.
 *
 * No prueba una función: lee el código fuente de este directorio, como las
 * pruebas espejo de domain/ y por el mismo camino (`?raw` de Vite, que es lo
 * que hay aquí en vez de node:fs).
 *
 * Existe porque el fallo que tapa no se ve en ninguna pantalla —PostgREST corta
 * en mil filas con un 200 y sin queja (lib/paging)— y porque ya ha vuelto tres
 * veces: la ficha de un amigo, la pantalla de confirmar de Steam, y
 * `useMyRatings`, que se quedó sin paginar mientras la cuenta pasaba de 1.460
 * notas. Las tres veces el síntoma fue el mismo: una lista llena, una afinidad
 * calculada sobre el trozo que cupo, y ni un error que lo dijera.
 *
 * La regla: una consulta de varias filas de `ratings` va dentro de `fetchPaged`,
 * o sea que lleva `.range()`. Se acepta `.maybeSingle()` —una nota concreta, que
 * es UNA fila por la clave única (user_id, title_id)— y se ignoran las
 * escrituras. Si algún día hace falta una lectura corta sin paginar, esto se
 * cambia con su porqué escrito al lado, que es justo lo que se quiere obligar a
 * escribir. */

const FUENTES = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as
  Record<string, string>;

/** El texto de cada cadena que empieza en `.from("ratings")`, hasta el `;` que
 *  la cierra: es el ámbito donde tiene que estar la prueba de que esa lectura
 *  no se trunca. */
function cadenas(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf('.from("ratings")'); i >= 0; i = src.indexOf('.from("ratings")', i + 1)) {
    const fin = src.indexOf(";", i);
    out.push(src.slice(i, fin < 0 ? src.length : fin));
  }
  return out;
}

const ESCRITURAS = [".upsert(", ".insert(", ".update(", ".delete("];

describe("las lecturas de ratings se paginan", () => {
  const lecturas = Object.entries(FUENTES)
    .filter(([ruta]) => !ruta.endsWith(".test.ts"))
    .flatMap(([ruta, src]) => cadenas(src).map((cadena, n) => ({ ruta, n, cadena })))
    .filter(({ cadena }) => !ESCRITURAS.some((e) => cadena.includes(e)));

  it("hay lecturas que mirar (si esto falla, la guarda dejó de ver el código)", () => {
    expect(lecturas.length).toBeGreaterThan(3);
  });

  for (const { ruta, n, cadena } of lecturas) {
    it(`${ruta}: la lectura #${n + 1} pagina o pide una sola fila`, () => {
      expect(
        cadena.includes(".range(") || cadena.includes(".maybeSingle()"),
        `Esta lectura de ratings se corta en 1.000 filas sin avisar. Métela en ` +
          `fetchPaged con su .order() total (lib/paging):\n${cadena.trim()}`,
      ).toBe(true);
    });
  }
});
