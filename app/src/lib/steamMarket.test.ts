import { describe, expect, it } from "vitest";

import { marketUrl } from "@/lib/steamMarket";

/* El enlace de cada baldosa de la rejilla. Lo único que tiene miga es el
   escapado: el nombre de mercado va dentro de la ruta y lleva caracteres que
   la parten. */
describe("el enlace a la ficha de Steam", () => {
  it("escapa la barra vertical y los espacios del nombre", () => {
    expect(marketUrl(730, "AK-47 | Redline (Field-Tested)")).toBe(
      "https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20(Field-Tested)",
    );
  });

  /* Sin codificar, esta barra abriría la ruta de OTRO objeto —una barra en
     medio del nombre es un segmento más de la URL— y Steam contestaría con un
     404 en vez de con la ficha. */
  it("escapa la barra que partiría la ruta", () => {
    expect(marketUrl(730, "Sticker | Vox Eminor / Cologne 2015")).toContain(
      "Vox%20Eminor%20%2F%20Cologne%202015",
    );
  });

  it("deja el appid tal cual, que es el que separa CS2 de Dota", () => {
    expect(marketUrl(570, "Gamma Case")).toBe(
      "https://steamcommunity.com/market/listings/570/Gamma%20Case",
    );
  });
});
