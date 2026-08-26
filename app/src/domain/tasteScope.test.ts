import { describe, expect, it } from "vitest";
import { ofMedium, sheetParam, tasteCopy } from "@/domain/tasteScope";

/* La regla que sostienen estas pruebas es una, y es la que rompió la afinidad
   cuando llegaron el cine y los juegos: un `tmdb_id` NO identifica un título,
   identifica un título DENTRO de un medio. Todo lo que compara notas tiene que
   recortar por medio antes de cruzar números, y todo lo que abre una ficha
   tiene que decir en qué espacio de numeración vive el número que lleva. */

const row = (kind: "tv" | "movie" | "game", tmdb_id: number) => ({ kind, tmdb_id });

describe("ofMedium", () => {
  it("se queda con las filas de un medio y descarta las demás", () => {
    const rows = [row("tv", 1399), row("movie", 1399), row("game", 1399)];
    expect(ofMedium(rows, "tv")).toEqual([row("tv", 1399)]);
    expect(ofMedium(rows, "movie")).toEqual([row("movie", 1399)]);
    expect(ofMedium(rows, "game")).toEqual([row("game", 1399)]);
  });

  it("el 1399 de cada medio es una cosa distinta", () => {
    // Es LA avería: sin este recorte, tu serie 1399 (Juego de Tronos) y la
    // película 1399 de un amigo contaban como una nota en común, y la afinidad
    // salía de comparar dos títulos que no tienen nada que ver.
    const mine = ofMedium([row("tv", 1399)], "tv").map((r) => r.tmdb_id);
    const theirs = ofMedium([row("movie", 1399)], "tv").map((r) => r.tmdb_id);
    expect(mine).toEqual([1399]);
    expect(theirs).toEqual([]);
  });

  it("una lista sin nada de ese medio se queda vacía, no a medias", () => {
    expect(ofMedium([row("tv", 1), row("tv", 2)], "game")).toEqual([]);
  });
});

describe("sheetParam", () => {
  it("cada medio abre su ficha con su parámetro", () => {
    expect(sheetParam("tv")).toBe("title");
    expect(sheetParam("movie")).toBe("movie");
    expect(sheetParam("game")).toBe("game");
  });
});

describe("tasteCopy", () => {
  it("cada medio habla de lo suyo", () => {
    expect(tasteCopy("tv").ratedInCommon).toBe("rated in common");
    expect(tasteCopy("movie").ratedInCommon).toBe("movies rated in common");
    expect(tasteCopy("game").ratedInCommon).toBe("games rated in common");
  });

  it("ningún medio comparte frase con otro", () => {
    // Compartir una clave entre dos medios es exactamente el bug de género que
    // esto existe para evitar: "puntuadas en común" dicho de unos juegos.
    const claves = (["tv", "movie", "game"] as const).map((m) => Object.values(tasteCopy(m)));
    const todas = claves.flat();
    expect(new Set(todas).size).toBe(todas.length);
  });
});
