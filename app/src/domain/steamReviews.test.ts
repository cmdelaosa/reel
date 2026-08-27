import { describe, expect, it } from "vitest";
import { steamReviewColor, steamReviewLabel } from "./steamReviews";

/* Lo que estas pruebas vigilan es la parte contraintuitiva de la escala de
   Steam: el número de reseñas mueve la etiqueta DENTRO del mismo porcentaje.
   Un cambio que mire solo el porcentaje pasaría casi todos los casos obvios y
   rompería justo los dos extremos, que son los que la gente reconoce. */

describe("steamReviewLabel", () => {
  it("el mismo 97% cambia de etiqueta según cuántas reseñas lo sostengan", () => {
    expect(steamReviewLabel({ percent: 97, count: 854808 })).toBe("steam: Overwhelmingly Positive");
    expect(steamReviewLabel({ percent: 97, count: 300 })).toBe("steam: Very Positive");
    expect(steamReviewLabel({ percent: 97, count: 30 })).toBe("steam: Positive");
  });

  it("y el mismo 10% también, en espejo", () => {
    expect(steamReviewLabel({ percent: 10, count: 854808 })).toBe("steam: Overwhelmingly Negative");
    expect(steamReviewLabel({ percent: 10, count: 300 })).toBe("steam: Very Negative");
    expect(steamReviewLabel({ percent: 10, count: 30 })).toBe("steam: Negative");
  });

  it("los tramos de en medio no miran el número de reseñas", () => {
    for (const count of [10, 500, 900000]) {
      expect(steamReviewLabel({ percent: 75, count })).toBe("steam: Mostly Positive");
      expect(steamReviewLabel({ percent: 55, count })).toBe("steam: Mixed");
      expect(steamReviewLabel({ percent: 25, count })).toBe("steam: Mostly Negative");
    }
  });

  it("cada frontera cae del lado que dice Steam", () => {
    expect(steamReviewLabel({ percent: 95, count: 500 })).toBe("steam: Overwhelmingly Positive");
    expect(steamReviewLabel({ percent: 94, count: 500 })).toBe("steam: Very Positive");
    expect(steamReviewLabel({ percent: 80, count: 50 })).toBe("steam: Very Positive");
    expect(steamReviewLabel({ percent: 79, count: 50 })).toBe("steam: Mostly Positive");
    expect(steamReviewLabel({ percent: 70, count: 50 })).toBe("steam: Mostly Positive");
    expect(steamReviewLabel({ percent: 69, count: 50 })).toBe("steam: Mixed");
    expect(steamReviewLabel({ percent: 40, count: 50 })).toBe("steam: Mixed");
    expect(steamReviewLabel({ percent: 39, count: 50 })).toBe("steam: Mostly Negative");
    expect(steamReviewLabel({ percent: 20, count: 50 })).toBe("steam: Mostly Negative");
    expect(steamReviewLabel({ percent: 19, count: 50 })).toBe("steam: Very Negative");
  });

  it("sin reseñas no hay etiqueta que poner", () => {
    expect(steamReviewLabel({ percent: 100, count: 0 })).toBeNull();
    expect(steamReviewLabel(null)).toBeNull();
    expect(steamReviewLabel(undefined)).toBeNull();
  });
});

describe("steamReviewColor", () => {
  it("tres tramos, y el de en medio es gris y no un aviso", () => {
    expect(steamReviewColor(97)).toBe("var(--accent)");
    expect(steamReviewColor(70)).toBe("var(--accent)");
    expect(steamReviewColor(69)).toBe("var(--text-dim)");
    expect(steamReviewColor(40)).toBe("var(--text-dim)");
    expect(steamReviewColor(39)).toBe("#e5484d");
  });
});
