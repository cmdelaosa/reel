import { describe, expect, it } from "vitest";
import { formatRelease, groupReleases, isReleased, releaseGroupOf } from "@/domain/gameRelease";

describe("formatRelease", () => {
  it("un día exacto se escribe entero", () => {
    expect(formatRelease("2025-09-04", "day")).toBe("September 4, 2025");
    expect(formatRelease("2025-09-04", "day", { es: true })).toBe("4 septiembre 2025");
  });

  it("un trimestre NO se escribe como el día que guardamos", () => {
    // La propiedad que da sentido al fichero. 0071 guarda "2027-12-31" para un
    // "Q4 2027" porque necesita un día con el que ordenar; imprimirlo sería
    // convertir un detalle de almacenamiento en una promesa que nadie hizo.
    expect(formatRelease("2027-12-31", "q4")).toBe("Q4 2027");
    expect(formatRelease("2027-03-31", "q1")).toBe("Q1 2027");
  });

  it("un año tampoco", () => {
    expect(formatRelease("2027-12-31", "year")).toBe("2027");
  });

  it("un mes se escribe sin día", () => {
    expect(formatRelease("2027-11-30", "month")).toBe("November 2027");
    expect(formatRelease("2027-11-30", "month", { es: true })).toBe("noviembre 2027");
  });

  it("sin fecha o sin precisión, no se inventa nada", () => {
    expect(formatRelease(null, "day")).toBe("TBA");
    expect(formatRelease("2027-12-31", "tbd")).toBe("TBA");
    expect(formatRelease("2027-12-31", null)).toBe("TBA");
    expect(formatRelease(null, null, { es: true })).toBe("Sin fecha");
  });
});

describe("isReleased", () => {
  it("un día exacto ya pasado cuenta como salido", () => {
    expect(isReleased("2025-09-04", "day", "2026-08-24")).toBe(true);
    expect(isReleased("2027-03-12", "day", "2026-08-24")).toBe(false);
  });

  it("un trimestre no cuenta hasta que acaba entero", () => {
    // Estamos dentro de Q4 2026 y el juego "sale en Q4 2026": todavía no se
    // puede afirmar que esté fuera. Decirlo mandaría a alguien a buscarlo.
    expect(isReleased("2026-12-31", "q4", "2026-11-15")).toBe(false);
    expect(isReleased("2026-12-31", "q4", "2027-01-02")).toBe(true);
  });

  it("sin fecha nunca ha salido", () => {
    expect(isReleased(null, "day", "2026-08-24")).toBe(false);
    expect(isReleased("2020-01-01", "tbd", "2026-08-24")).toBe(false);
  });
});

describe("releaseGroupOf", () => {
  it("un día exacto es su propio grupo", () => {
    expect(releaseGroupOf({ first_air_date: "2027-11-15", release_precision: "day" }))
      .toEqual({ key: "2027-11-15", kind: "day" });
  });

  it("un mes agrupa el mes entero", () => {
    expect(releaseGroupOf({ first_air_date: "2027-03-31", release_precision: "month" }))
      .toEqual({ key: "2027-03", kind: "month" });
  });

  it("un trimestre se nombra por el trimestre, no por el mes guardado", () => {
    // 0071 guarda el ÚLTIMO día del periodo, así que un Q4 llega como 31 de
    // diciembre. Agrupar por el mes de esa fecha diría "diciembre 2027" de algo
    // que puede salir en octubre.
    expect(releaseGroupOf({ first_air_date: "2027-12-31", release_precision: "q4" }))
      .toEqual({ key: "2027-Q4", kind: "quarter" });
  });

  it("un año, por el año", () => {
    expect(releaseGroupOf({ first_air_date: "2028-12-31", release_precision: "year" }))
      .toEqual({ key: "2028", kind: "year" });
  });

  it("sin fecha, sin precisión o con 'tbd' cae al mismo grupo", () => {
    expect(releaseGroupOf({ first_air_date: null, release_precision: "day" }).kind).toBe("tbd");
    expect(releaseGroupOf({ first_air_date: "2027-12-31", release_precision: "tbd" }).kind).toBe("tbd");
    expect(releaseGroupOf({ first_air_date: "2027-12-31", release_precision: null }).kind).toBe("tbd");
    // Una precisión que este build no conoce (una columna de mañana) es un dato
    // del que no se puede afirmar nada: al cajón de sin fecha, no a un grupo
    // inventado.
    expect(releaseGroupOf({ first_air_date: "2027-12-31", release_precision: "decade" }).kind).toBe("tbd");
  });
});

describe("groupReleases", () => {
  const row = (name: string, first_air_date: string | null, release_precision: string | null) =>
    ({ name, first_air_date, release_precision });

  it("ordena por fecha y, a igualdad, de lo más estrecho a lo más ancho", () => {
    // Los tres últimos se guardan como 2027-12-31 (fin de su periodo), así que
    // la fecha no los desempata: lo hace cuánto de ella es cierto.
    const groups = groupReleases([
      row("año", "2027-12-31", "year"),
      row("cuarto", "2027-12-31", "q4"),
      row("día", "2027-12-31", "day"),
      row("marzo", "2027-03-31", "month"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2027-03", "2027-12-31", "2027-Q4", "2027"]);
  });

  it("lo indatable va al final, no donde caiga su fecha", () => {
    const groups = groupReleases([
      row("sin fecha", null, null),
      row("pronto", "2026-09-01", "day"),
      row("lejos", "2030-12-31", "year"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["day", "year", "tbd"]);
  });

  it("junta en un grupo lo que comparte periodo, en el orden en que llega", () => {
    const groups = groupReleases([
      row("a", "2027-12-31", "q4"),
      row("b", "2027-12-31", "q4"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("cada grupo lleva con qué escribir su rótulo", () => {
    const [g] = groupReleases([row("a", "2027-12-31", "q4")]);
    expect(formatRelease(g.date, g.precision)).toBe("Q4 2027");
  });

  it("no pierde ni duplica filas", () => {
    const rows = [
      row("a", "2026-09-01", "day"), row("b", "2026-09-01", "day"),
      row("c", "2027-03-31", "month"), row("d", null, "tbd"),
      row("e", "2028-12-31", "year"),
    ];
    const out = groupReleases(rows).flatMap((g) => g.items);
    expect(out).toHaveLength(rows.length);
    expect(new Set(out.map((r) => r.name)).size).toBe(rows.length);
  });
});
