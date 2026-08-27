import { describe, expect, it } from "vitest";
import { byName, nameKey, otherEdition, type MyGame } from "./steamMatch";

/* La matriz de la señal que avisa de un mal casado. Lo que se prueba es que
   levanta la mano en el caso real que la motivó y que NO la levanta cuando la
   importación ha acertado — una señal que salta siempre deja de mirarse. */

describe("nameKey", () => {
  it("iguala el guion de Steam con los dos puntos de IGDB", () => {
    // El caso real: Steam escribe una cosa y IGDB otra, y es el mismo juego.
    expect(nameKey("Agatha Christie - The ABC Murders"))
      .toBe(nameKey("Agatha Christie: The ABC Murders"));
  });

  it("no le importan mayúsculas, acentos ni espacios de más", () => {
    expect(nameKey("  PÓKEMON   Red ")).toBe("pokemon red");
  });

  it("pero sigue distinguiendo dos juegos distintos", () => {
    // Lo que separa a Doom de Doom II es un número, y un normalizador con
    // demasiadas ganas se lo comería.
    expect(nameKey("Doom")).not.toBe(nameKey("Doom II"));
    expect(nameKey("Portal")).not.toBe(nameKey("Portal 2"));
  });
});

describe("otherEdition", () => {
  const abc2016: MyGame = {
    titleId: "a4461b93",
    name: "Agatha Christie: The ABC Murders",
    year: "2016",
    platform: "PC (Microsoft Windows)",
  };

  it("avisa cuando ya sigues el juego con otra ficha", () => {
    // La avería del 27-ago-2026: la importación casó con la ficha de 2009 (de
    // Nintendo DS) teniendo tú la de 2016 en la biblioteca.
    const matched = { id: "7e6b66ca", name: "Agatha Christie: The ABC Murders" };
    expect(otherEdition(matched, byName([abc2016]))).toBe(abc2016);
  });

  it("calla cuando ha casado con la ficha que ya sigues", () => {
    const matched = { id: "a4461b93", name: "Agatha Christie: The ABC Murders" };
    expect(otherEdition(matched, byName([abc2016]))).toBeNull();
  });

  it("calla con un juego que no tienes", () => {
    const matched = { id: "otro", name: "Hollow Knight" };
    expect(otherEdition(matched, byName([abc2016]))).toBeNull();
  });

  it("calla cuando la importación no ha casado con nada", () => {
    // Lo que aún no tiene ficha se resuelve después, contra IGDB.
    expect(otherEdition(null, byName([abc2016]))).toBeNull();
  });
});
