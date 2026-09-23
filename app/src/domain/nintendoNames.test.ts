import { describe, expect, it } from "vitest";
import { isDemo, isSystemApp, suggestedByDefault } from "./nintendoNames";

/* Los nombres de las apps son literales de un registro de juego real, guiones
   incluidos: Nintendo mezcla el guion normal y el largo en la misma lista, y
   ese detalle es justo lo que rompe una comparación ingenua. */
describe("isSystemApp", () => {
  it("reconoce las apps de Nintendo Switch Online con los dos guiones", () => {
    for (
      const name of [
        "Nintendo Entertainment System - Nintendo Switch Online",
        "Super Nintendo Entertainment System - Nintendo Switch Online",
        "Nintendo 64 – Nintendo Switch Online",
        "SEGA Genesis – Nintendo Switch Online",
        "Game Boy - Nintendo Switch Online",
        "Game Boy Advance - Nintendo Switch Online",
        "Nintendo GameCube – Nintendo Classics",
      ]
    ) {
      expect(isSystemApp(name), name).toBe(true);
    }
  });

  it("no se lleva por delante los juegos", () => {
    for (
      const name of [
        "Super Mario Odyssey",
        "The Legend of Zelda: Tears of the Kingdom",
        "Mario Kart World",
        "Donkey Kong Bananza",
        // El caso incómodo: un juego que habla de la consola en su título.
        "Nintendo Switch Sports",
      ]
    ) {
      expect(isSystemApp(name), name).toBe(false);
    }
  });
});

describe("isDemo", () => {
  it("reconoce las demos como las escribe Nintendo", () => {
    expect(isDemo("Kirby and the Forgotten Land (Demo Version)")).toBe(true);
    expect(isDemo("Donkey Kong Country Returns HD DEMO")).toBe(true);
    expect(isDemo("Demo de Pikmin 4")).toBe(true);
  });

  it("no marca los juegos que solo LLEVAN esas letras", () => {
    // Sin límite de palabra, estos dos se quedaban sin marcar y nadie entendía
    // por qué.
    expect(isDemo("Demon's Souls")).toBe(false);
    expect(isDemo("Demolition Company")).toBe(false);
  });
});

describe("suggestedByDefault", () => {
  it("lo que ya sigues viene marcado, sea lo que sea", () => {
    // Incluso una app: si ya la tienes en Reel, desmarcarla sola sería
    // proponerte deshacer algo que ya decidiste.
    expect(suggestedByDefault({ name: "Nintendo 64 – Nintendo Switch Online", in_library: true }))
      .toBe(true);
  });

  it("un juego nuevo viene marcado; una app o una demo, no", () => {
    expect(suggestedByDefault({ name: "Split Fiction", in_library: false })).toBe(true);
    expect(suggestedByDefault({ name: "Game Boy - Nintendo Switch Online", in_library: false }))
      .toBe(false);
    expect(suggestedByDefault({ name: "Donkey Kong Country Returns HD DEMO", in_library: false }))
      .toBe(false);
  });
});
