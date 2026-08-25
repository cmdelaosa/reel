import { describe, expect, it } from "vitest";
import { orderByTouched, pickResume, touchedMs } from "@/domain/gameTonight";

const g = (o: Partial<Parameters<typeof touchedMs>[0]> & { status: string; added_at: string }) => ({
  played_at: null,
  ...o,
});

describe("touchedMs", () => {
  it("manda played_at cuando lo hay", () => {
    expect(touchedMs(g({ status: "playing", added_at: "2026-01-01T00:00:00Z", played_at: "2026-08-20T10:00:00Z" })))
      .toBe(Date.parse("2026-08-20T10:00:00Z"));
  });

  it("sin played_at cae a added_at", () => {
    // 0075 no rellenó la columna hacia atrás a propósito: las partidas viejas
    // se ordenan por cuándo entraron en Reel, que es lo único cierto de ellas.
    expect(touchedMs(g({ status: "playing", added_at: "2026-01-01T00:00:00Z" })))
      .toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("un added_at ilegible no envenena el orden", () => {
    // Comparar con NaN siempre da false, así que un solo NaN deja el sort
    // entero en un orden arbitrario — no solo esa fila.
    expect(touchedMs(g({ status: "playing", added_at: "no es una fecha" }))).toBe(0);
  });
});

describe("orderByTouched", () => {
  const games = [
    g({ status: "playing", added_at: "2026-01-01T00:00:00Z", played_at: "2026-08-01T00:00:00Z" }),
    g({ status: "playing", added_at: "2026-06-01T00:00:00Z" }),
    g({ status: "playing", added_at: "2026-01-01T00:00:00Z", played_at: "2026-08-23T00:00:00Z" }),
    g({ status: "backlog", added_at: "2026-08-24T00:00:00Z" }),
    g({ status: "ongoing", added_at: "2026-08-24T00:00:00Z", played_at: "2026-08-24T00:00:00Z" }),
  ];

  it("solo lo que estás jugando, por lo último tocado", () => {
    expect(orderByTouched(games).map((x) => x.played_at ?? x.added_at)).toEqual([
      "2026-08-23T00:00:00Z",
      "2026-08-01T00:00:00Z",
      "2026-06-01T00:00:00Z",
    ]);
  });

  it("deja fuera 'sin final', aunque sea lo más reciente", () => {
    // Un CS marcado 'ongoing' es lo que aparcaste, no a lo que vuelves.
    expect(orderByTouched(games).some((x) => x.status === "ongoing")).toBe(false);
  });

  it("no muta la lista que recibe", () => {
    const before = games.map((x) => x.added_at);
    orderByTouched(games);
    expect(games.map((x) => x.added_at)).toEqual(before);
  });
});

describe("pickResume", () => {
  it("lo último que tocaste de lo que estás jugando", () => {
    const picked = pickResume([
      g({ status: "playing", added_at: "2026-01-01T00:00:00Z", played_at: "2026-08-01T00:00:00Z" }),
      g({ status: "playing", added_at: "2026-01-01T00:00:00Z", played_at: "2026-08-23T00:00:00Z" }),
    ]);
    expect(picked?.played_at).toBe("2026-08-23T00:00:00Z");
  });

  it("sin nada empezado, cae al pendiente más reciente", () => {
    const picked = pickResume([
      g({ status: "backlog", added_at: "2026-08-01T00:00:00Z" }),
      g({ status: "backlog", added_at: "2026-08-20T00:00:00Z" }),
    ]);
    expect(picked?.added_at).toBe("2026-08-20T00:00:00Z");
  });

  /* 'owned' (0076) — lo traído de Steam y sin tocar. No es 'backlog' a
     propósito, pero sí es candidato a esta noche. */
  it("sin pendientes, cae a lo que tienes y no has empezado", () => {
    // Quien llega a Reel importando su cuenta de Steam no tiene un solo
    // 'backlog': sin esto, su portada de juegos sale vacía — que es justo lo
    // que la caída existe para evitar.
    const picked = pickResume([
      g({ status: "owned", added_at: "2026-08-01T00:00:00Z" }),
      g({ status: "owned", added_at: "2026-08-20T00:00:00Z" }),
    ]);
    expect(picked?.added_at).toBe("2026-08-20T00:00:00Z");
  });

  it("un pendiente gana a algo que solo tienes, aunque sea más viejo", () => {
    // Ponerlo en Pendientes fue una decisión tuya; estar en tu cuenta de Steam
    // no lo es.
    const picked = pickResume([
      g({ status: "owned", added_at: "2026-08-24T00:00:00Z" }),
      g({ status: "backlog", added_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(picked?.status).toBe("backlog");
  });

  it("nunca cae a un juego que no ha salido", () => {
    // Proponerte esta noche algo que todavía no existe es la única respuesta
    // claramente inútil que esta pantalla puede dar.
    expect(pickResume([g({ status: "upcoming", added_at: "2026-08-24T00:00:00Z" })])).toBeUndefined();
  });

  it("ni a uno terminado o abandonado", () => {
    expect(pickResume([
      g({ status: "finished", added_at: "2026-08-24T00:00:00Z" }),
      g({ status: "dropped", added_at: "2026-08-24T00:00:00Z" }),
    ])).toBeUndefined();
  });

  it("con la biblioteca vacía no hay héroe", () => {
    expect(pickResume([])).toBeUndefined();
  });
});
