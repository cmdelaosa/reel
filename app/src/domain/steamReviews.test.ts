import { describe, expect, it } from "vitest";
import { compareBySteamReviews, steamReviewColor, steamReviewLabel } from "./steamReviews";

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

describe("compareBySteamReviews", () => {
  const juego = (name: string, percent?: number, count?: number) => ({
    name,
    steam_reviews: percent == null ? null : { percent, count: count ?? 1000 },
  });

  const ordenar = (...juegos: ReturnType<typeof juego>[]) =>
    [...juegos].sort(compareBySteamReviews).map((g) => g.name);

  it("de más a menos porcentaje", () => {
    expect(ordenar(juego("medio", 72), juego("alto", 96), juego("bajo", 31)))
      .toEqual(["alto", "medio", "bajo"]);
  });

  it("empatados en porcentaje manda el número de reseñas", () => {
    /* La razón por la que `count` viaja en el rollup: un 100 % de tres
       personas no es mejor que un 100 % de ocho mil, y sin esto la rejilla lo
       pondría primero por el orden en que llegaran las filas. */
    /* Los nombres van a contrapelo del alfabeto a propósito: con "ocho mil" y
       "tres votos" el desempate por nombre daba el mismo orden que el correcto,
       y quitar el desempate por reseñas no rompía nada. */
    expect(ordenar(juego("a: tres votos", 100, 3), juego("z: ocho mil", 100, 8000)))
      .toEqual(["z: ocho mil", "a: tres votos"]);
  });

  it("lo que no está en Steam va al final, y no al fondo de la escala", () => {
    /* Y va detrás TAMBIÉN de lo peor valorado: un juego de consola sin ficha de
       Steam no es un suspenso, y colarlo entre los porcentajes bajos diría que
       sí. Esto es lo que se rompería tratando el null como un 0. */
    expect(ordenar(juego("sin steam"), juego("horrible", 12), juego("bueno", 88)))
      .toEqual(["bueno", "horrible", "sin steam"]);
  });

  it("cero reseñas es no tener ficha, y no un porcentaje que valga", () => {
    /* El 100 % es aposta: con `count: 0` Steam devuelve un porcentaje que no
       significa nada, y leerlo pondría un juego que nadie ha reseñado por
       delante de todo lo demás. */
    expect(ordenar(juego("nadie", 100, 0), juego("flojo", 35))).toEqual(["flojo", "nadie"]);
  });

  it("la cola sin nota queda alfabética, y no en el orden en que llegó", () => {
    expect(ordenar(juego("zelda"), juego("abzu"), juego("halo"))).toEqual(["abzu", "halo", "zelda"]);
  });
});
