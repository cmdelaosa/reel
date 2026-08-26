import { describe, expect, it } from "vitest";
import { platformFamily } from "@/domain/platformFamily";

/* Los nombres son los DE IGDB, copiados tal cual: son los que llegan a
   `titles.platforms` y los únicos que este mapa tiene que reconocer. */
describe("platformFamily", () => {
  it("reconoce las tres consolas", () => {
    expect(platformFamily("PlayStation 5")).toBe("playstation");
    expect(platformFamily("PlayStation Vita")).toBe("playstation");
    expect(platformFamily("Xbox Series X|S")).toBe("xbox");
    expect(platformFamily("Xbox 360")).toBe("xbox");
    expect(platformFamily("Nintendo Switch 2")).toBe("nintendo");
    expect(platformFamily("Wii U")).toBe("nintendo");
    expect(platformFamily("Game Boy Advance")).toBe("nintendo");
  });

  it("el PC de IGDB es Windows", () => {
    // El nombre real, que lleva las dos palabras dentro.
    expect(platformFamily("PC (Microsoft Windows)")).toBe("windows");
    expect(platformFamily("DOS")).toBe("windows");
  });

  it("Mac y iOS comparten manzana", () => {
    expect(platformFamily("Mac")).toBe("apple");
    expect(platformFamily("iOS")).toBe("apple");
  });

  it("una Steam Deck es Steam y no Linux", () => {
    expect(platformFamily("SteamOS")).toBe("steam");
    // Esta es la que ata el ORDEN: con las dos palabras dentro gana la primera
    // regla que casa, y tiene que ser la de Steam.
    expect(platformFamily("Steam Deck (Linux)")).toBe("steam");
    expect(platformFamily("Steam Deck")).toBe("steam");
    expect(platformFamily("Linux")).toBe("linux");
  });

  it("el resto tiene dibujo genérico, nunca un hueco", () => {
    expect(platformFamily("Sega Mega Drive/Genesis")).toBe("other");
    expect(platformFamily("Atari 2600")).toBe("other");
    expect(platformFamily("")).toBe("other");
  });

  it("Android, navegador y recreativa", () => {
    expect(platformFamily("Android")).toBe("android");
    expect(platformFamily("Web browser")).toBe("web");
    expect(platformFamily("Arcade")).toBe("arcade");
  });

  /* La razón de ser del mapa por patrón: la consola que salga mañana cae en su
     familia sin tocar este fichero. */
  it("una consola que aún no existe cae en su familia", () => {
    expect(platformFamily("PlayStation 7")).toBe("playstation");
    expect(platformFamily("Xbox Infinite")).toBe("xbox");
  });
});
