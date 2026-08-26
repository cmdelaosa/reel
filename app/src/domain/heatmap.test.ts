import { describe, expect, it } from "vitest";
import { heatDays, heatLevel, type HeatRow } from "@/domain/heatmap";

/* Lo que sostienen estas pruebas: el color del cuadradito dice DE QUÉ fue el
   día, y la intensidad dice CUÁNTO. Son dos ejes, y confundirlos es lo que
   hacía la rejilla anterior — un solo acento para los tres medios. */

const row = (day: string, kind: HeatRow["kind"], n: number): HeatRow => ({ day, kind, n });

describe("heatDays", () => {
  it("suma los tres medios en el total del día y los desglosa", () => {
    const days = heatDays([
      row("2026-08-20", "tv", 3),
      row("2026-08-20", "movie", 1),
    ]);
    expect(days.get("2026-08-20")).toEqual({
      total: 4,
      dominant: "tv",
      byKind: [{ kind: "tv", n: 3 }, { kind: "movie", n: 1 }],
    });
  });

  it("el medio con más actividad ese día le pone el color", () => {
    const days = heatDays([
      row("2026-08-20", "tv", 1),
      row("2026-08-20", "game", 2),
    ]);
    expect(days.get("2026-08-20")?.dominant).toBe("game");
  });

  it("con empate gana el medio más raro de la ventana", () => {
    // 300 episodios contra 2 juegos en el año: un martes de 1 y 1 es el día del
    // juego. Con un orden fijo "series primero", la rejilla de quien ve una
    // serie a diario saldría coral entera y el color no diría nada.
    const days = heatDays([
      ...Array.from({ length: 100 }, (_, i) => row(`2026-05-${String((i % 28) + 1).padStart(2, "0")}`, "tv", 3)),
      row("2026-08-20", "tv", 1),
      row("2026-08-20", "game", 1),
    ]);
    expect(days.get("2026-08-20")?.dominant).toBe("game");
  });

  it("la rareza no pisa al recuento del día", () => {
    // Lo raro solo DESEMPATA. Cinco episodios y un juego es un día de series
    // por mucho que el juego sea la rareza del año.
    const days = heatDays([
      ...Array.from({ length: 50 }, (_, i) => row(`2026-05-${String((i % 28) + 1).padStart(2, "0")}`, "tv", 4)),
      row("2026-08-20", "tv", 5),
      row("2026-08-20", "game", 1),
    ]);
    expect(days.get("2026-08-20")?.dominant).toBe("tv");
  });

  it("con empate y misma rareza el orden es estable, no el de llegada", () => {
    const a = heatDays([row("2026-08-20", "movie", 1), row("2026-08-20", "tv", 1)]);
    const b = heatDays([row("2026-08-20", "tv", 1), row("2026-08-20", "movie", 1)]);
    expect(a.get("2026-08-20")?.dominant).toBe(b.get("2026-08-20")?.dominant);
    expect(a.get("2026-08-20")?.dominant).toBe("tv");
  });

  it("sin medio (la función vieja) el día cuenta pero no tiñe", () => {
    // El respaldo del hueco de despliegue: `rpc_watch_heatmap` devuelve (día, n)
    // y la rejilla sale monocroma. Rellenar el hueco con "tv" habría teñido de
    // coral el año entero de quien solo juega.
    const days = heatDays([row("2026-08-20", null, 4)]);
    expect(days.get("2026-08-20")).toEqual({ total: 4, dominant: null, byKind: [] });
  });

  it("un día a cero no entra en la rejilla", () => {
    expect(heatDays([row("2026-08-20", "tv", 0)]).has("2026-08-20")).toBe(false);
  });
});

describe("heatLevel", () => {
  it("un día con algo nunca es un día vacío", () => {
    // Un episodio suelto en un año de maratones de treinta redondeaba a cero y
    // desaparecía de la rejilla.
    expect(heatLevel(1, 30)).toBe(1);
  });

  it("cero es cero", () => {
    expect(heatLevel(0, 30)).toBe(0);
  });

  it("el máximo llena el cuadradito", () => {
    expect(heatLevel(30, 30)).toBe(4);
  });

  it("no se sale de cuatro aunque el día supere el máximo", () => {
    expect(heatLevel(60, 30)).toBe(4);
  });

  it("reparte los escalones intermedios", () => {
    expect([heatLevel(3, 12), heatLevel(6, 12), heatLevel(9, 12)]).toEqual([1, 2, 3]);
  });
});
