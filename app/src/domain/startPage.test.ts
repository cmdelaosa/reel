import { describe, expect, it } from "vitest";
import {
  DEFAULT_START_MEDIUM, resolveStartMedium, START_OPTIONS, startRoute,
} from "@/domain/startPage";
import { HOME, sectionOfPath } from "@/domain/mediumRoute";

describe("startPage", () => {
  it("ofrece los tres modos, en el orden del conmutador", () => {
    expect(START_OPTIONS.map((o) => o.medium)).toEqual(["tv", "movie", "game"]);
  });

  it("abre en la portada del modo elegido", () => {
    expect(startRoute("tv")).toBe(HOME.tv);
    expect(startRoute("movie")).toBe(HOME.movie);
    expect(startRoute("game")).toBe(HOME.game);
  });

  it("y esas tres portadas son rutas que el Shell reconoce", () => {
    // Si una dejara de pertenecer a una sección, abrir ahí dejaría la barra sin
    // pestaña encendida.
    for (const o of START_OPTIONS) {
      expect(sectionOfPath(HOME[o.medium])).toBe("tonight");
    }
  });

  it("cae en series con cualquier otra cosa", () => {
    // Lo que llega de localStorage es de fuera, y acaba en un navigate().
    expect(resolveStartMedium(undefined)).toBe(DEFAULT_START_MEDIUM);
    expect(resolveStartMedium(null)).toBe(DEFAULT_START_MEDIUM);
    expect(resolveStartMedium(42)).toBe(DEFAULT_START_MEDIUM);
    expect(resolveStartMedium("series")).toBe(DEFAULT_START_MEDIUM);
    // Lo que guardaba la primera versión de este ajuste, que era una ruta.
    expect(resolveStartMedium("/games/backlog")).toBe(DEFAULT_START_MEDIUM);
    expect(startRoute("https://otro-sitio.example/")).toBe(HOME.tv);
    expect(startRoute("//otro-sitio.example")).toBe(HOME.tv);
  });
});
