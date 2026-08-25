import { describe, expect, it } from "vitest";
import { fetchRollupPaged, ROLLUP_PAGE } from "@/lib/library";

/* La matriz del paginado de la biblioteca.
 *
 * Lo que se juzga aquí es un fallo que NO se ve: PostgREST devuelve las primeras
 * mil filas con un 200 y sin queja, así que una biblioteca leída a medias se
 * pinta como una biblioteca entera. Pasó de verdad el 25-08-2026 —2.107 títulos,
 * y "Tu cine" enseñando 220 de 1.325— y lo único que lo delataba era el
 * `content-range` de la respuesta, que nadie mira. */

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ title_id: `t${offset + i}` }));

/** Una tabla de `total` filas servida por ventanas, contando las peticiones. */
function fake(total: number) {
  const calls: [number, number][] = [];
  return {
    calls,
    page: (from: number, to: number) => {
      calls.push([from, to]);
      return Promise.resolve({ data: rows(Math.max(0, Math.min(to + 1, total) - from), from), error: null });
    },
  };
}

describe("fetchRollupPaged", () => {
  it("una biblioteca que cabe en una página se lee de una vez", async () => {
    const t = fake(42);
    expect((await fetchRollupPaged(t.page)).length).toBe(42);
    expect(t.calls.length).toBe(1);
  });

  it("una biblioteca de más de mil se lee ENTERA, que es el fallo que esto arregla", async () => {
    const t = fake(2107);
    expect((await fetchRollupPaged(t.page)).length).toBe(2107);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("un total múltiplo exacto del tamaño pide una página más, que vuelve vacía", async () => {
    const t = fake(ROLLUP_PAGE);
    expect((await fetchRollupPaged(t.page)).length).toBe(ROLLUP_PAGE);
    expect(t.calls.length).toBe(2);
  });

  it("una biblioteca vacía no da la vuelta dos veces", async () => {
    const t = fake(0);
    expect(await fetchRollupPaged(t.page)).toEqual([]);
    expect(t.calls.length).toBe(1);
  });

  it("un error se levanta, no se confunde con 'no hay nada'", async () => {
    await expect(
      fetchRollupPaged(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });

  it("cada ventana pide la siguiente franja, sin solaparse ni saltarse una fila", async () => {
    const t = fake(2500);
    const all = (await fetchRollupPaged(t.page)) as { title_id: string }[];
    expect(new Set(all.map((r) => r.title_id)).size).toBe(2500);
  });
});
