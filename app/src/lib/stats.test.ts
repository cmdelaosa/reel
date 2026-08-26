import { describe, expect, it } from "vitest";
import { timeSpentLabel } from "@/lib/stats";
import { resetSettings, setSetting } from "@/lib/settings";

/* El rótulo de tiempo total del perfil. Lo que se comprueba es el singular,
   porque es lo que estaba mal: una sola cadena "days" imprimía "1 días" y
   "1 days" para cualquier total que redondeara a uno.

   Y el singular se decide sobre el número YA redondeado, que es el que se ve:
   1,4 días se enseña como "1", así que tiene que decir "1 día" aunque el valor
   real no sea exactamente uno. Ese desajuste entre lo que se calcula y lo que
   se imprime es donde vuelven estos fallos. */

const MIN_POR_DIA = 60 * 24;

describe("timeSpentLabel", () => {
  it("dice el singular cuando lo que se imprime es un 1", () => {
    resetSettings();
    setSetting("language", "en");
    expect(timeSpentLabel(MIN_POR_DIA)).toBe("1 day");
    // 1,4 días: redondea a 1, así que el rótulo también tiene que ir en singular.
    expect(timeSpentLabel(Math.round(MIN_POR_DIA * 1.4))).toBe("1 day");
  });

  it("dice el plural en cuanto se imprime otra cosa", () => {
    resetSettings();
    setSetting("language", "en");
    expect(timeSpentLabel(MIN_POR_DIA * 2)).toBe("2 days");
    // 1,6 días redondea a 2 — el plural sigue al número impreso, no al real.
    expect(timeSpentLabel(Math.round(MIN_POR_DIA * 1.6))).toBe("2 days");
    expect(timeSpentLabel(MIN_POR_DIA * 77)).toBe("77 days");
  });

  it("traduce las dos formas", () => {
    resetSettings();
    setSetting("language", "es");
    expect(timeSpentLabel(MIN_POR_DIA)).toBe("1 día");
    expect(timeSpentLabel(MIN_POR_DIA * 3)).toBe("3 días");
  });

  it("por debajo de un día no habla de días", () => {
    resetSettings();
    setSetting("language", "es");
    expect(timeSpentLabel(90)).toBe("2h");
    expect(timeSpentLabel(45)).toBe("45m");
  });
});
