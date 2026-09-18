import { describe, expect, it } from "vitest";
import { fetchPaged, fetchPagedParallel, PAGE_MAX, restOffsets } from "@/lib/paging";

/* La matriz del paginado de PostgREST.
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

describe("fetchPaged", () => {
  it("una lista que cabe en una página se lee de una vez", async () => {
    const t = fake(42);
    expect((await fetchPaged(t.page)).length).toBe(42);
    expect(t.calls.length).toBe(1);
  });

  it("una lista de más de mil se lee ENTERA, que es el fallo que esto arregla", async () => {
    const t = fake(2107);
    expect((await fetchPaged(t.page)).length).toBe(2107);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("un total múltiplo exacto del tamaño pide una página más, que vuelve vacía", async () => {
    const t = fake(PAGE_MAX);
    expect((await fetchPaged(t.page)).length).toBe(PAGE_MAX);
    expect(t.calls.length).toBe(2);
  });

  it("una lista vacía no da la vuelta dos veces", async () => {
    const t = fake(0);
    expect(await fetchPaged(t.page)).toEqual([]);
    expect(t.calls.length).toBe(1);
  });

  it("un error se levanta, no se confunde con 'no hay nada'", async () => {
    await expect(
      fetchPaged(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });

  it("cada ventana pide la siguiente franja, sin solaparse ni saltarse una fila", async () => {
    const t = fake(2500);
    const all = (await fetchPaged(t.page)) as { title_id: string }[];
    expect(new Set(all.map((r) => r.title_id)).size).toBe(2500);
  });
});

/* La aritmética de las ventanas que faltan. Venía de lib/i18n, que fue quien
   primero pidió en paralelo; se mudó aquí con la función. Es donde un paginado
   falla de la forma cara: pedir de menos no revienta, deja huecos — y un hueco
   es un puñado de filas que no se pintan, sin nada que lo delate. */
describe("restOffsets", () => {
  it("no pide nada cuando todo cupo en la primera página", () => {
    expect(restOffsets(600, 1000)).toEqual([]);
    expect(restOffsets(1000, 1000)).toEqual([]);
  });

  it("pide la segunda cuando sobra una fila", () => {
    expect(restOffsets(1001, 1000)).toEqual([1000]);
  });

  it("cubre el total exacto sin pedir una página de más", () => {
    expect(restOffsets(3000, 1000)).toEqual([1000, 2000]);
  });

  it("cuenta con lo que VINO, no con lo que se pidió", () => {
    /* El caso que justifica la función: el servidor tope a 500 aunque se
       pidieran 1.000. Con el tamaño pedido saldría [1000, 2000] y se perderían
       las filas 500-999 y 1500-1999 sin un solo error. */
    expect(restOffsets(2000, 500)).toEqual([500, 1000, 1500]);
  });

  it("no divide entre cero cuando la primera página vino vacía", () => {
    expect(restOffsets(0, 0)).toEqual([]);
    expect(restOffsets(1436, 0)).toEqual([]);
  });
});

/* El paginado en paralelo, que es el mismo contrato de `fetchPaged` —ni una
   fila perdida, ni una repetida— con otro reloj. Lo que se juzga aquí es
   justo lo que lo distingue: que el total llegue de la primera ventana, que
   las demás salgan A LA VEZ, y que cuando no hay total siga siendo completo
   aunque sea lento. */
function fakeParallel(total: number, serverCap = PAGE_MAX) {
  const calls: { from: number; to: number; withCount: boolean }[] = [];
  /** Cuántas peticiones había en vuelo a la vez, como mucho. */
  let enVuelo = 0;
  let maxEnVuelo = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  return {
    calls,
    get maxEnVuelo() { return maxEnVuelo; },
    /** Suelta las peticiones que estén esperando. */
    abrir: () => release?.(),
    page: async (from: number, to: number, withCount: boolean) => {
      calls.push({ from, to, withCount });
      enVuelo += 1;
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      // Solo las que van después de la primera esperan: así el máximo de
      // simultáneas mide si el bucle encadena o no.
      if (from > 0) await gate;
      enVuelo -= 1;
      const width = Math.min(to + 1 - from, serverCap);
      return {
        data: rows(Math.max(0, Math.min(from + width, total) - from), from),
        error: null,
        count: withCount ? total : undefined,
      };
    },
  };
}

describe("fetchPagedParallel", () => {
  it("una lista que cabe en una ventana se lee de una vez, y pide el total", async () => {
    const t = fakeParallel(42);
    expect((await fetchPagedParallel(t.page)).length).toBe(42);
    expect(t.calls).toEqual([{ from: 0, to: PAGE_MAX - 1, withCount: true }]);
  });

  it("las ventanas que faltan van A LA VEZ, no en fila", async () => {
    const t = fakeParallel(2500);
    const p = fetchPagedParallel(t.page);
    // Un tick para que la primera vuelva y se lancen las demás.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    t.abrir();
    const all = (await p) as { title_id: string }[];
    expect(all.length).toBe(2500);
    expect(new Set(all.map((r) => r.title_id)).size).toBe(2500);
    // Dos en vuelo a la vez es lo que este módulo viene a hacer: encadenando,
    // el máximo sería 1 y la prueba se quedaría colgada en la primera espera.
    expect(t.maxEnVuelo).toBe(2);
  });

  it("el COUNT se pide SOLO en la primera", async () => {
    const t = fakeParallel(2500);
    const p = fetchPagedParallel(t.page);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    t.abrir();
    await p;
    expect(t.calls.filter((c) => c.withCount).length).toBe(1);
    expect(t.calls[0].withCount).toBe(true);
  });

  it("un total múltiplo exacto del tamaño NO pide una ventana de más", async () => {
    // Es lo que `fetchPaged` no puede evitar: sin total, la única forma de
    // saber que 2.000 filas se acabaron es pedir la ventana 2000-2999.
    const t = fakeParallel(2 * PAGE_MAX);
    const p = fetchPagedParallel(t.page);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    t.abrir();
    expect((await p).length).toBe(2 * PAGE_MAX);
    expect(t.calls.length).toBe(2);
  });

  it("tesela con lo que VINO: un servidor que sirve de menos no deja huecos", async () => {
    // El tope real es 500 aunque se pidan 1.000. Las ventanas se reparten de
    // 500 en 500 porque es lo que trajo la primera.
    const t = fakeParallel(1800, 500);
    const p = fetchPagedParallel(t.page);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    t.abrir();
    const all = (await p) as { title_id: string }[];
    expect(new Set(all.map((r) => r.title_id)).size).toBe(1800);
  });

  it("sin total se encadena hasta la ventana vacía, que es lento pero completo", async () => {
    // `count` ausente —un servidor que no lo sirve— NO puede leerse como "no
    // queda nada": eso truncaría en silencio justo lo que esto arregla.
    const calls: number[] = [];
    const rowsFor = (from: number, total: number) =>
      rows(Math.max(0, Math.min(from + PAGE_MAX, total) - from), from);
    const all = (await fetchPagedParallel((from) => {
      calls.push(from);
      return Promise.resolve({ data: rowsFor(from, 2500), error: null });
    })) as { title_id: string }[];
    expect(all.length).toBe(2500);
    expect(new Set(all.map((r) => r.title_id)).size).toBe(2500);
    expect(calls).toEqual([0, 1000, 2000, 2500]);
  });

  it("un error se levanta, no se confunde con 'no hay nada'", async () => {
    await expect(
      fetchPagedParallel(() => Promise.resolve({ data: null, error: { message: "boom" }, count: null })),
    ).rejects.toThrow("boom");
  });

  it("un error en una ventana paralela tampoco se traga", async () => {
    await expect(
      fetchPagedParallel((from, _to, withCount) =>
        Promise.resolve(
          from === 0
            ? { data: rows(PAGE_MAX), error: null, count: withCount ? 2500 : undefined }
            : { data: null, error: { message: "la segunda se cayó" } },
        ),
      ),
    ).rejects.toThrow("la segunda se cayó");
  });
});
