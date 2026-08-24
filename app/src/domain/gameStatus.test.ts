import { describe, expect, it } from "vitest";
import {
  deriveGameStatus,
  formatPlaytime,
  hoursProgress,
  type PlayState,
} from "@/domain/gameStatus";

const derive = (
  airedCount: number,
  watchedCount: number,
  playState: PlayState | null = null,
) => deriveGameStatus({ airedCount, watchedCount, playState });

describe("deriveGameStatus", () => {
  it("sin decir nada: pendiente si ya salió, próximo si no", () => {
    expect(derive(1, 0)).toBe("backlog");
    expect(derive(0, 0)).toBe("upcoming");
  });

  it("lo que dijiste a mano manda sobre la fecha", () => {
    // Acceso anticipado, betas, o un juego que IGDB fecha mal: si dices que lo
    // estás jugando, lo estás jugando.
    expect(derive(0, 0, "playing")).toBe("playing");
    expect(derive(0, 0, "ongoing")).toBe("ongoing");
    expect(derive(0, 0, "dropped")).toBe("dropped");
  });

  it("terminado manda sobre todo lo demás", () => {
    // Mismo argumento que en el cine: se puede terminar algo antes de que la
    // fuente lo dé por lanzado, y decir "aún no ha salido" sobre algo que
    // alguien acaba de terminarse es llamarle mentiroso.
    expect(derive(1, 1, "playing")).toBe("finished");
    expect(derive(0, 1)).toBe("finished");
    expect(derive(1, 1, "dropped")).toBe("finished");
  });

  it("un juego dejado sigue dejado aunque ya hubiera salido", () => {
    expect(derive(1, 0, "dropped")).toBe("dropped");
  });
});

describe("hoursProgress", () => {
  const beats = { normally: 86_400 }; // 24 h

  it("mide contra 'normally', en porcentaje", () => {
    expect(hoursProgress(12 * 60, beats, "playing")).toBe(50);
    expect(hoursProgress(24 * 60, beats, "playing")).toBe(100);
  });

  it("un juego sin final no tiene barra", () => {
    // Un CS con 400 horas no está al 400% de nada: null es la señal de
    // "enseña las horas a secas".
    expect(hoursProgress(400 * 60, beats, "ongoing")).toBeNull();
  });

  it("sin tiempos de IGDB tampoco hay barra", () => {
    // Los juegos pequeños no los tienen. Una barra sobre un denominador
    // inventado es peor que ninguna barra.
    expect(hoursProgress(600, null, "playing")).toBeNull();
    expect(hoursProgress(600, {}, "playing")).toBeNull();
    expect(hoursProgress(600, { normally: 0 }, "playing")).toBeNull();
  });

  it("pasar del 100% no se recorta", () => {
    // Si le has echado el doble de la media, la barra llena y el número
    // diciendo 200% es la lectura correcta, no un error que tapar.
    expect(hoursProgress(48 * 60, beats, "finished")).toBe(200);
  });

  it("cero horas con denominador es 0, no null", () => {
    // 0 y "no se puede medir" son cosas distintas y el render las pinta
    // distinto: barra vacía frente a sin barra.
    expect(hoursProgress(0, beats, "backlog")).toBe(0);
  });
});

describe("formatPlaytime", () => {
  it("por debajo de una hora, minutos", () => {
    // "40 min" es una tarde con un juego pequeño; redondearlo a 0 h o a 1 h
    // miente en las dos direcciones.
    expect(formatPlaytime(40)).toBe("40 min");
    expect(formatPlaytime(59)).toBe("59 min");
  });

  it("entre una y diez horas, horas y minutos", () => {
    expect(formatPlaytime(150)).toBe("2 h 30 min");
    expect(formatPlaytime(60)).toBe("1 h");
  });

  it("a partir de diez horas, los minutos sobran", () => {
    expect(formatPlaytime(634)).toBe("10 h");
    expect(formatPlaytime(24 * 60 + 37)).toBe("24 h");
  });

  it("sin horas, cero", () => {
    expect(formatPlaytime(0)).toBe("0 h");
    expect(formatPlaytime(-5)).toBe("0 h");
  });
});
