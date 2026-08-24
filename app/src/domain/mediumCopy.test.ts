import { describe, expect, it } from "vitest";
import {
  addedList,
  addedListOf,
  historyLines,
  mediumLabel,
  showsEpisodeCount,
  watchedPhrase,
} from "@/domain/mediumCopy";

/* La regla que estas pruebas sostienen es una sola, y es la que los episodios
   sintéticos de 0067 y 0071 ponen en peligro cada vez que alguien toca estas
   pantallas: ni una película ni un videojuego se cuentan por episodios, por
   mucho que por debajo tengan uno.

   La segunda, que llegó con los juegos (0074): el mismo watch_event no se dice
   con las mismas palabras en los tres medios. */

describe("watchedPhrase", () => {
  it("una serie se cuenta por episodios", () => {
    expect(watchedPhrase("tv")).toBe("with-episodes");
  });

  it("una película se cuenta entera", () => {
    expect(watchedPhrase("movie")).toBe("whole-title");
  });

  it("un juego no se ve: se termina", () => {
    // Mismo watch_event que en cine, otra frase. Si esto volviera a
    // "whole-title", el muro publicaría "Vio Silksong" — la etiqueta prestada
    // que 0071 se negó a publicar.
    expect(watchedPhrase("game")).toBe("whole-title-finished");
  });
});

describe("addedList", () => {
  it("series y cine añaden a la watchlist", () => {
    expect(addedList("tv")).toBe("watchlist");
    expect(addedList("movie")).toBe("watchlist");
  });

  it("un juego se añade a los pendientes, que es como se llama su cubo", () => {
    expect(addedList("game")).toBe("backlog");
  });
});

/* La tercera lista (0077), que no la decide el medio sino la fila: un juego
   marcado "Lo tengo" (0076) no está en Pendientes — ese estado existe para
   sacarlo de ese cubo—, así que del muro no puede salir "lo añadió a sus
   pendientes". */
describe("addedListOf", () => {
  it("manda lo que diga el servidor", () => {
    expect(addedListOf("game", "library")).toBe("library");
    expect(addedListOf("game", "backlog")).toBe("backlog");
    expect(addedListOf("tv", "watchlist")).toBe("watchlist");
  });

  it("sin columna, el respaldo es lo que se sabe del medio", () => {
    // El hueco entre desplegar el frontend y aplicar la migración: la fila
    // llega sin `added_list` y tiene que pintarse igual que ayer, no romperse.
    expect(addedListOf("game")).toBe("backlog");
    expect(addedListOf("game", null)).toBe("backlog");
    expect(addedListOf("movie", undefined)).toBe("watchlist");
  });

  it("un valor que no reconoce no se cuela hasta la frase", () => {
    // Si mañana el servidor inventa una lista, la fila dice lo de siempre en
    // vez de quedarse sin frase: no hay clave de diccionario para "inventada".
    expect(addedListOf("game", "inventada")).toBe("backlog");
    expect(addedListOf("tv", "")).toBe("watchlist");
  });
});

describe("mediumLabel", () => {
  it("da la clave del diccionario de cada medio", () => {
    expect(mediumLabel("tv")).toBe("TV series");
    expect(mediumLabel("movie")).toBe("Movie");
    expect(mediumLabel("game")).toBe("Game");
  });
});

describe("showsEpisodeCount", () => {
  it("una serie con varios episodios el mismo día los cuenta", () => {
    expect(showsEpisodeCount("tv", 3)).toBe(true);
  });

  it("un solo episodio no se cuenta: el rango ya lo dice", () => {
    expect(showsEpisodeCount("tv", 1)).toBe(false);
  });

  it("una película nunca cuenta episodios, ni aunque llegue un recuento", () => {
    // El RPC agrupa por (persona, título, día) y podría devolver >1 si alguien
    // marcase y desmarcase; la fila de cine no debe enseñarlo igualmente.
    expect(showsEpisodeCount("movie", 3)).toBe(false);
    expect(showsEpisodeCount("movie", 1)).toBe(false);
  });

  it("un juego tampoco, por lo mismo", () => {
    expect(showsEpisodeCount("game", 3)).toBe(false);
    expect(showsEpisodeCount("game", 1)).toBe(false);
  });
});

describe("historyLines", () => {
  it("en una serie manda el episodio", () => {
    expect(historyLines("tv")).toEqual({ headline: "episode-number", caption: "episode-name" });
  });

  it("en una película manda ella, y debajo el estudio", () => {
    // Nunca "episode-name": en una película es una copia de su propio título.
    expect(historyLines("movie")).toEqual({ headline: "title", caption: "studio" });
  });

  it("en un juego manda él, y debajo el desarrollador", () => {
    // `network` en un juego es el estudio que lo hizo (normalize.ts), así que
    // la misma caption vale sin cambiar de columna.
    expect(historyLines("game")).toEqual({ headline: "title", caption: "studio" });
  });
});
