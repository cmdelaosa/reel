import { describe, expect, it } from "vitest";
import {
  dateTicks,
  nearestIndex,
  offeredRanges,
  tickUnit,
  windowSeries,
} from "@/domain/steamSeriesView";

/* Lo que sostienen estas pruebas: la ventana cuelga del último dato y no de
   hoy, el eje pone marcas legibles a cualquier escala —de tres meses a trece
   años—, y el foco del ratón sigue la POSICIÓN y no el número de punto, que en
   una serie de densidad variable son dos cosas distintas. */

const p = (day: string) => ({ day });

const days = (from: string, n: number, stepDays = 1) =>
  Array.from({ length: n }, (_, i) =>
    p(new Date(Date.parse(from) + i * stepDays * 86_400_000).toISOString().slice(0, 10)),
  );

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("windowSeries", () => {
  it("3m corta noventa y un días contados desde el último punto", () => {
    const serie = days("2026-01-01", 400);
    const cut = windowSeries(serie, "3m");
    expect(cut[cut.length - 1].day).toBe(serie[serie.length - 1].day);
    expect(cut).toHaveLength(92); // los 91 días de ventana, más el propio último
  });

  it("la ventana no se mide desde hoy: una serie que acaba hace un año sigue dando su año entero", () => {
    /* El caso que lo motiva: el cron no corrió, o el volcado es viejo. Midiendo
       desde hoy, «1 año» de una serie parada devolvería cero puntos y la
       tarjeta diría que no hay gráfica. */
    const serie = days("2020-01-01", 500);
    expect(windowSeries(serie, "1y")).toHaveLength(366);
  });

  it("all no toca nada, ni siquiera una serie vacía", () => {
    const serie = days("2026-01-01", 10);
    expect(windowSeries(serie, "all")).toBe(serie);
    expect(windowSeries([], "all")).toEqual([]);
  });

  it("una serie corta sobrevive entera a una ventana larga", () => {
    const serie = days("2026-08-01", 5);
    expect(windowSeries(serie, "1y")).toHaveLength(5);
  });
});

describe("offeredRanges", () => {
  it("una serie de años las ofrece las tres", () => {
    expect(offeredRanges(days("2020-01-01", 2400))).toEqual(["3m", "1y", "all"]);
  });

  it("con un solo punto dentro de la ventana, esa ventana no se ofrece", () => {
    /* Puntos espaciados: dentro de los tres meses solo cae el último, así que
       «3 meses» llevaría al cartel de «todavía no hay gráfica». */
    const serie = [p("2025-01-01"), p("2025-03-01"), p("2025-07-01")];
    expect(offeredRanges(serie)).toEqual(["all"]);
  });

  it("una ventana que no recorta nada no se ofrece: dibujaría la misma curva", () => {
    /* Un inventario de un mes cabe entero en las tres ventanas. Tres botones
       que dibujan lo mismo no son una elección. */
    expect(offeredRanges(days("2026-08-01", 30))).toEqual(["all"]);
  });

  it("se ofrece la que recorta aunque la de en medio no lo haga", () => {
    /* Doscientos días: tres meses recortan, un año no — y «1 año» y «Todo»
       serían el mismo dibujo. */
    expect(offeredRanges(days("2026-02-11", 200))).toEqual(["3m", "all"]);
  });

  it("`all` se ofrece siempre que haya curva, y nunca se cae por no recortar", () => {
    expect(offeredRanges(days("2026-08-01", 2))).toEqual(["all"]);
  });

  it("sin curva no se ofrece nada, ni siquiera el todo", () => {
    expect(offeredRanges(days("2026-08-01", 1))).toEqual([]);
    expect(offeredRanges([])).toEqual([]);
  });

  it("salen de estrecha a ancha, y con el todo siempre el último", () => {
    /* El componente se apoya en las dos cosas: cuando la ventana elegida no
       está ofrecida cae a `offered[0]` para quedarse con la más estrecha que
       haya, y da por hecho que el todo está si hay algo. */
    for (const serie of [
      days("2020-01-01", 2400),
      [p("2025-01-01"), p("2025-03-01"), p("2025-07-01")],
      days("2026-02-11", 200),
      days("2026-08-01", 30),
    ]) {
      const got = offeredRanges(serie);
      expect(got).toEqual(["3m", "1y", "all"].filter((r) => got.includes(r as never)));
      expect(got[got.length - 1]).toBe("all");
    }
  });

  it("faltando el tramo corto, la más estrecha que queda es el año", () => {
    /* Meses sin subir nada: en los tres últimos cae un solo punto, así que
       «3 meses» no se ofrece y el componente tiene que caer al año — no al
       todo, que es el extremo contrario del que se pide al abrir. */
    const serie = [
      p("2024-01-01"), p("2024-07-01"), p("2025-01-01"),
      p("2025-11-01"), p("2026-01-01"), p("2026-08-31"),
    ];
    expect(offeredRanges(serie)).toEqual(["1y", "all"]);
  });
});

describe("dateTicks", () => {
  const ms = (day: string) => Date.parse(day + "T00:00:00Z");

  it("reparte marcas de tres meses cada dos semanas", () => {
    const t = dateTicks(ms("2026-06-01"), ms("2026-08-31"));
    expect(t.length).toBeGreaterThanOrEqual(5);
    expect(t.length).toBeLessThanOrEqual(8);
    expect(iso(t[t.length - 1])).toBe("2026-08-31");
    expect((t[1] - t[0]) / 86_400_000).toBe(14);
  });

  it("la última marca cae SIEMPRE en el último dato, no en un múltiplo del salto", () => {
    /* Si se contara hacia delante desde el principio, la punta de la curva
       —justo donde está la cifra— se quedaría sin fecha debajo. */
    const t = dateTicks(ms("2026-06-03"), ms("2026-08-27"));
    expect(iso(t[t.length - 1])).toBe("2026-08-27");
  });

  it("en cuanto el tramo es de meses las marcas caen en el día 1", () => {
    const t = dateTicks(ms("2025-09-01"), ms("2026-08-31"));
    expect(t.every((x) => new Date(x).getUTCDate() === 1)).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(5);
    expect(t.length).toBeLessThanOrEqual(8);
  });

  it("trece años no se llenan de marcas: siguen siendo un puñado", () => {
    const t = dateTicks(ms("2013-05-01"), ms("2026-08-31"));
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(8);
    expect(t[0]).toBeGreaterThanOrEqual(ms("2013-05-01"));
  });

  it("ninguna marca se sale del tramo, en ninguna escala", () => {
    for (const [from, to] of [
      ["2026-08-25", "2026-08-31"],
      ["2026-06-01", "2026-08-31"],
      ["2025-01-01", "2026-08-31"],
      ["2013-01-01", "2026-08-31"],
    ]) {
      const t = dateTicks(ms(from), ms(to));
      expect(t[0]).toBeGreaterThanOrEqual(ms(from));
      expect(t[t.length - 1]).toBeLessThanOrEqual(ms(to));
      /* Y en orden, que es como las lee el eje. */
      expect([...t].sort((a, b) => a - b)).toEqual(t);
    }
  });

  it("un tramo sin ancho devuelve una marca y no se cuelga", () => {
    expect(dateTicks(ms("2026-08-31"), ms("2026-08-31"))).toEqual([ms("2026-08-31")]);
  });
});

describe("tickUnit", () => {
  const ms = (day: string) => Date.parse(day + "T00:00:00Z");
  it("día en tres meses, mes en un año, año en trece", () => {
    expect(tickUnit(ms("2026-06-01"), ms("2026-08-31"))).toBe("day");
    expect(tickUnit(ms("2025-09-01"), ms("2026-08-31"))).toBe("month");
    expect(tickUnit(ms("2013-01-01"), ms("2026-08-31"))).toBe("year");
  });
});

describe("nearestIndex", () => {
  it("sigue la posición, no el número de punto", () => {
    /* Serie de densidad variable, que es la que devuelve la RPC: cuatro puntos
       apelotonados a la derecha y dos sueltos a la izquierda. Repartiendo el
       ancho entre el número de puntos, el ratón en 500 apuntaría al tercero. */
    const xs = [60, 300, 820, 840, 860, 880];
    expect(nearestIndex(xs, 500)).toBe(1);
    expect(nearestIndex(xs, 845)).toBe(3);
  });

  it("fuera del dibujo se pega al extremo", () => {
    const xs = [60, 300, 880];
    expect(nearestIndex(xs, -200)).toBe(0);
    expect(nearestIndex(xs, 9000)).toBe(2);
  });

  it("con un empate se queda con el primero, y no con ninguno", () => {
    expect(nearestIndex([100, 200], 150)).toBe(0);
  });
});
