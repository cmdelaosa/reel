import { describe, expect, it } from "vitest";
import { DEFAULT_START, resolveStart, START_GROUPS } from "@/domain/startPage";
import { ROUTES, sectionOfPath } from "@/domain/mediumRoute";

describe("startPage", () => {
  it("ofrece las doce casillas de la tabla, agrupadas por medio", () => {
    expect(START_GROUPS.map((g) => g.medium)).toEqual(["tv", "movie", "game"]);
    expect(START_GROUPS.flatMap((g) => g.options)).toHaveLength(12);
  });

  it("todas sus rutas son rutas vivas de mediumRoute", () => {
    const vivas = new Set(Object.values(ROUTES).flatMap((r) => Object.values(r)));
    for (const o of START_GROUPS.flatMap((g) => g.options)) {
      expect(vivas.has(o.route)).toBe(true);
      // Y el Shell sabe reconocerlas: si una dejara de pertenecer a una
      // sección, abrir ahí dejaría la barra sin pestaña encendida.
      expect(sectionOfPath(o.route.split("?")[0])).not.toBeNull();
    }
  });

  it("no repite el mismo nombre dentro de un grupo", () => {
    for (const g of START_GROUPS) {
      expect(new Set(g.options.map((o) => o.label)).size).toBe(g.options.length);
    }
  });

  it("acepta una ruta guardada que esté en la lista", () => {
    expect(resolveStart("/games/backlog")).toBe("/games/backlog");
    expect(resolveStart("/shows?filter=watchlist")).toBe("/shows?filter=watchlist");
  });

  it("cae en la de siempre con cualquier otra cosa", () => {
    // Lo que llega de localStorage es de fuera, y acaba en un navigate().
    expect(resolveStart(undefined)).toBe(DEFAULT_START);
    expect(resolveStart(null)).toBe(DEFAULT_START);
    expect(resolveStart(42)).toBe(DEFAULT_START);
    expect(resolveStart("/shows")).toBe(DEFAULT_START); // sin ?filter=, no es la de la tabla
    expect(resolveStart("/games/library")).toBe(DEFAULT_START); // la vieja, hoy solo redirección
    expect(resolveStart("https://otro-sitio.example/")).toBe(DEFAULT_START);
    expect(resolveStart("//otro-sitio.example")).toBe(DEFAULT_START);
    expect(resolveStart("/login")).toBe(DEFAULT_START);
  });
});
