import { describe, expect, it } from "vitest";
import { externalScore, scoreColor, scoreLabel } from "./externalScore";

describe("externalScore", () => {
  it("prefiere la de IMDb cuando existe", () => {
    expect(externalScore({ imdb_rating: 8.4, vote_average: 7.9 })).toEqual({ value: 8.4, source: "imdb" });
  });

  it("cae a la de TMDB cuando no hay nota de IMDb", () => {
    expect(externalScore({ imdb_rating: null, vote_average: 7.9 })).toEqual({ value: 7.9, source: "tmdb" });
    expect(externalScore({ vote_average: 7.9 })).toEqual({ value: 7.9, source: "tmdb" });
  });

  it("devuelve null cuando ninguna de las dos dice nada", () => {
    expect(externalScore({ imdb_rating: null, vote_average: null })).toBeNull();
    expect(externalScore({})).toBeNull();
    expect(externalScore(null)).toBeNull();
    expect(externalScore(undefined)).toBeNull();
  });

  /* El cero de TMDB es "nadie ha votado", no un cero: es lo que trae cualquier
     estreno sin votos, y pintarlo lo presentaría como la peor nota posible. */
  it("trata el 0 como ausencia de nota, en las dos fuentes", () => {
    expect(externalScore({ imdb_rating: 0, vote_average: 7.9 })).toEqual({ value: 7.9, source: "tmdb" });
    expect(externalScore({ imdb_rating: 0, vote_average: 0 })).toBeNull();
    expect(externalScore({ vote_average: 0 })).toBeNull();
  });

  it("ignora lo que no es un número finito", () => {
    expect(externalScore({ imdb_rating: NaN, vote_average: 7.9 })).toEqual({ value: 7.9, source: "tmdb" });
    expect(externalScore({ imdb_rating: Infinity, vote_average: null })).toBeNull();
  });

  /* Una nota baja de verdad SÍ se enseña: 1.9 es un dato, 0 es un hueco. */
  it("no confunde una nota mala con la falta de nota", () => {
    expect(externalScore({ imdb_rating: 1.9, vote_average: 6.0 })).toEqual({ value: 1.9, source: "imdb" });
  });
});

describe("scoreColor / scoreLabel", () => {
  it("visten cada fuente con lo suyo", () => {
    expect(scoreColor("imdb")).toBe("var(--imdb)");
    expect(scoreColor("tmdb")).toBe("var(--accent)");
    expect(scoreLabel("imdb")).toBe("IMDb");
    expect(scoreLabel("tmdb")).toBe("TMDB");
  });
});
