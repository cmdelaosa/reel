import { describe, expect, it } from "vitest";
import { historyLines, showsEpisodeCount, watchedPhrase } from "@/domain/mediumCopy";

/* La regla que estas pruebas sostienen es una sola, y es la que el episodio
   sintético de 0067 pone en peligro cada vez que alguien toca estas pantallas:
   una película nunca se cuenta por episodios, por mucho que por debajo tenga
   uno. */

describe("watchedPhrase", () => {
  it("una serie se cuenta por episodios", () => {
    expect(watchedPhrase("tv")).toBe("with-episodes");
  });

  it("una película se cuenta entera", () => {
    expect(watchedPhrase("movie")).toBe("whole-title");
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
});

describe("historyLines", () => {
  it("en una serie manda el episodio", () => {
    expect(historyLines("tv")).toEqual({ headline: "episode-number", caption: "episode-name" });
  });

  it("en una película manda ella, y debajo el estudio", () => {
    // Nunca "episode-name": en una película es una copia de su propio título.
    expect(historyLines("movie")).toEqual({ headline: "title", caption: "studio" });
  });
});
