import { describe, expect, it } from "vitest";
import { formatRelease, isReleased } from "@/domain/gameRelease";

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
