import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { qk } from "@/lib/queryKeys";

/* La biblioteca partida en cuatro cachés (0099): una por medio y la de "todo".
 *
 * Lo que se juzga aquí es lo ÚNICO que hace viable partirla: que `qk.library`
 * siga siendo un prefijo que las alcanza a las cuatro. Media docena de sitios
 * —la importación, Steam, IGDB, seguir/parar/dejar de seguir, marcar visto—
 * invalidan por ese prefijo sin saber que hay medios, y el día que una clave
 * deje de colgar de él, esos sitios dejarán de refrescar la mitad de la app sin
 * un solo error: la rejilla se queda con las filas de antes.
 *
 * Y el otro lado de lo mismo: `setQueryData` es de UNA clave exacta, así que
 * una escritura optimista con `qk.library` a secas ya no escribe en ninguna
 * parte. Eso tampoco falla — solo deja de pintar al instante lo que se acaba de
 * tocar. De ahí la guarda de código fuente del final. */

const CLAVES = [qk.libraryOf(null), qk.libraryOf("tv"), qk.libraryOf("movie"), qk.libraryOf("game")];

const sembrar = () => {
  const qc = new QueryClient();
  for (const clave of CLAVES) qc.setQueryData(clave, [{ title_id: `de-${clave[1]}` }]);
  return qc;
};

describe("las claves de la biblioteca", () => {
  it("son una por medio, y ninguna es la de otro", () => {
    expect(new Set(CLAVES.map((c) => JSON.stringify(c))).size).toBe(4);
    expect(qk.libraryOf(null)).toEqual(qk.libraryOf(null));
    expect(qk.libraryOf("movie")).not.toEqual(qk.libraryOf("tv"));
  });

  it("todas cuelgan de qk.library, que es lo que hace que una invalidación las alcance", () => {
    const qc = sembrar();
    qc.invalidateQueries({ queryKey: qk.library });
    const estados = qc.getQueryCache().getAll().map((q) => q.state.isInvalidated);
    expect(estados).toEqual([true, true, true, true]);
  });

  it("una invalidación de un medio NO toca a los otros tres", () => {
    // El otro lado del prefijo: que exista no puede significar que todo sea lo
    // mismo, o partir la caché no habría servido de nada.
    const qc = sembrar();
    qc.invalidateQueries({ queryKey: qk.libraryOf("movie") });
    const tocadas = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => q.queryKey);
    expect(tocadas).toEqual([qk.libraryOf("movie")]);
  });

  it("setQueriesData sobre el prefijo escribe en las cuatro; setQueryData en ninguna", () => {
    const qc = sembrar();
    // Lo que hace `patchLibraries`: una escritura optimista llega a todas.
    qc.setQueriesData<{ title_id: string }[]>({ queryKey: qk.library }, (old) => [
      ...(old ?? []),
      { title_id: "recien-seguido" },
    ]);
    for (const clave of CLAVES) {
      expect(qc.getQueryData<{ title_id: string }[]>(clave)).toHaveLength(2);
    }

    // Y lo que pasaría con la clave suelta, que es el fallo silencioso: se
    // escribe en una caché que no lee nadie y las cuatro se quedan igual.
    qc.setQueryData<{ title_id: string }[]>(qk.library, [{ title_id: "a ninguna parte" }]);
    for (const clave of CLAVES) {
      expect(qc.getQueryData<{ title_id: string }[]>(clave)).toHaveLength(2);
    }
  });
});

/* La guarda, del mismo corte que ratingsPaged.test.ts: lee el código de este
   directorio. Existe porque el fallo que tapa no se ve —ni error, ni pantalla
   en blanco: solo lo optimista que deja de serlo— y porque la forma de
   reintroducirlo es escribir la línea que TODO EL MUNDO escribía hasta 0099. */
const FUENTES = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

describe("nadie vuelve a tratar qk.library como una clave suelta", () => {
  const prohibidas = [/setQueryData\s*(<[^>]*>)?\s*\(\s*qk\.library\s*[,)]/, /getQueryData\s*(<[^>]*>)?\s*\(\s*qk\.library\s*[,)]/];

  it("hay código que mirar (si esto falla, la guarda dejó de ver nada)", () => {
    expect(Object.keys(FUENTES).length).toBeGreaterThan(10);
  });

  for (const [ruta, src] of Object.entries(FUENTES)) {
    if (ruta.endsWith(".test.ts")) continue;
    it(`${ruta} usa el prefijo, no la clave`, () => {
      for (const prohibida of prohibidas) {
        expect(
          prohibida.test(src),
          `${ruta}: qk.library es un prefijo de cuatro cachés desde 0099. ` +
            "Con setQueryData/getQueryData a secas se escribe y se lee una caché que no pinta nadie; " +
            "van setQueriesData/getQueriesData sobre { queryKey: qk.library }.",
        ).toBe(false);
      }
    });
  }
});
