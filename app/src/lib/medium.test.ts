import { beforeEach, describe, expect, it, vi } from "vitest";

/* El modo se decide al importar el módulo —es lo que evita el fotograma en
   coral— así que cada caso planta la URL y el localStorage y vuelve a
   importarlo desde cero. */

async function bootAt(pathname: string, storage: Record<string, unknown> = {}) {
  localStorage.clear();
  vi.resetModules();
  for (const [k, v] of Object.entries(storage)) {
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  history.replaceState(null, "", pathname);
  return await import("@/lib/medium");
}

describe("el modo con el que se pinta el primer fotograma", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("lo dice la ruta cuando la ruta es de un medio", async () => {
    const { getMedium } = await bootAt("/games/backlog", { "reel.medium": "tv" });
    expect(getMedium()).toBe("game");
  });

  it('en "/" lo dice el modo elegido en Ajustes, no el de la última sesión', async () => {
    // El caso que importa: cerraste en Series y abres en Cine. "/" redirige a
    // /movies/tonight, así que pintar coral sería pintar el modo equivocado.
    const { getMedium } = await bootAt("/", {
      "reel.medium": "tv",
      "reel.settings": { startMedium: "movie" },
    });
    expect(getMedium()).toBe("movie");
    expect(document.documentElement.dataset.medium).toBe("movie");
  });

  it('en "/" sin ajuste guardado, series', async () => {
    const { getMedium } = await bootAt("/", { "reel.medium": "game" });
    expect(getMedium()).toBe("tv");
  });

  it("en una página compartida manda lo guardado: el modo es pegajoso", async () => {
    const { getMedium } = await bootAt("/friends", {
      "reel.medium": "game",
      "reel.settings": { startMedium: "movie" },
    });
    expect(getMedium()).toBe("game");
  });
});
