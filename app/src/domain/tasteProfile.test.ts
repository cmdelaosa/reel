import { describe, expect, it } from "vitest";
import { tasteBlocks, type TasteInput } from "@/domain/tasteProfile";

/* La regla: un bloque por medio, y la segunda fila de cada uno describe lo suyo
   con lo suyo. Mezclar los tres en una lista de géneros da "Animación · 40"
   sumando animes, Pixar y Marios, que no describe a nadie. */

const tv = (genres: string[], network: string | null = null): TasteInput => ({ kind: "tv", genres, network });
const movie = (genres: string[], first_air_date: string | null = null): TasteInput => ({ kind: "movie", genres, first_air_date });
const game = (genres: string[], platforms: string[] = []): TasteInput => ({ kind: "game", genres, platforms });

describe("tasteBlocks", () => {
  it("separa los géneros por medio en vez de sumarlos", () => {
    const blocks = tasteBlocks([tv(["Animation"]), movie(["Animation"]), game(["Animation"])]);
    expect(blocks.map((b) => b.medium)).toEqual(["tv", "movie", "game"]);
    expect(blocks.every((b) => b.genres)).toBe(true);
    for (const b of blocks) expect(b.genres).toEqual([{ name: "Animation", count: 1 }]);
  });

  it("los medios sin nada no salen", () => {
    // A quien solo ve series, dos bloques en blanco permanentes le dicen menos
    // que nada — la misma regla que las estadísticas del perfil.
    expect(tasteBlocks([tv(["Drama"])]).map((b) => b.medium)).toEqual(["tv"]);
  });

  it("mantiene el orden canónico aunque las filas lleguen revueltas", () => {
    const blocks = tasteBlocks([game(["RPG"]), tv(["Drama"]), movie(["Horror"])]);
    expect(blocks.map((b) => b.medium)).toEqual(["tv", "movie", "game"]);
  });

  it("las series se describen con su cadena", () => {
    const [block] = tasteBlocks([tv(["Drama"], "HBO"), tv(["Drama"], "HBO"), tv(["Comedy"], "Netflix")]);
    expect(block.chipKind).toBe("network");
    expect(block.chips).toEqual([{ name: "HBO", count: 2 }, { name: "Netflix", count: 1 }]);
    expect(block.genres).toEqual([{ name: "Drama", count: 2 }, { name: "Comedy", count: 1 }]);
    expect(block.titles).toBe(3);
  });

  it("el cine se describe por décadas", () => {
    const [block] = tasteBlocks([movie(["Drama"], "1994-09-23"), movie(["Crime"], "1999-03-31"), movie(["Sci-Fi"], "2014-11-05")]);
    expect(block.chipKind).toBe("decade");
    expect(block.chips).toEqual([{ name: "1990", count: 2 }, { name: "2010", count: 1 }]);
  });

  it("una película sin fecha no inventa una década", () => {
    // `Number("")` es 0 y una fecha rara es NaN: las dos fabricaban "los 0".
    const [block] = tasteBlocks([movie(["Drama"], null), movie(["Drama"], "")]);
    expect(block.chips).toEqual([]);
  });

  it("un juego cuenta en todas sus plataformas", () => {
    // Elegir una sola por él sería decidir por la persona cuál es "su" versión.
    const [block] = tasteBlocks([game(["RPG"], ["Nintendo Switch", "PC"]), game(["RPG"], ["PC"])]);
    expect(block.chipKind).toBe("platform");
    expect(block.chips).toEqual([{ name: "PC", count: 2 }, { name: "Nintendo Switch", count: 1 }]);
  });

  it("los chips se quedan en cinco", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((n) => tv(["Drama"], n));
    expect(tasteBlocks(rows)[0].chips).toHaveLength(5);
  });

  it("los géneros salen enteros, que quien pinta decide cuántos caben", () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((g) => tv([g]));
    expect(tasteBlocks(rows)[0].genres).toHaveLength(10);
  });

  it("dos recuentos iguales salen siempre en el mismo orden", () => {
    const a = tasteBlocks([tv(["Zulu"]), tv(["Alfa"])])[0].genres;
    const b = tasteBlocks([tv(["Alfa"]), tv(["Zulu"])])[0].genres;
    expect(a).toEqual(b);
    expect(a[0].name).toBe("Alfa");
  });
});
