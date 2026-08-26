import { describe, expect, it } from "vitest";
import { fittingTabs } from "@/domain/tabFit";

/* Las trampas de esta cuenta son todas de una unidad, y las tres que importan
   están abajo con su nombre: el hueco que se cuenta una vez menos que las
   pestañas, el hueco de más que aparece con el botón del menú, y el ajuste
   exacto, que cabe.

   Los anchos sintéticos son redondos a propósito —100 y 10— para que la cuenta
   se pueda hacer de cabeza al leer la prueba. La fila de Juegos son medidas
   reales, tomadas en el navegador el 26-08-2026 con la hoja de la app en
   español; sirven para que un ejemplo de aquí se parezca a lo que se ve, no
   para predecir cuántas caben en una ventana concreta — eso depende de lo que
   midan la marca, el conmutador y las acciones, que no es asunto de este
   módulo. */

const gap = 4;
const moreWidth = 36;

/** Las seis de Juegos, medidas una a una. Suman 661,9 y con sus cinco huecos
 *  piden 681,9. */
const JUEGOS = [118.5, 136.9, 119.4, 101.4, 88.9, 96.8];
const PIDEN = 681.9;

describe("fittingTabs", () => {
  it("si caben todas, no hay menú y no se le reserva sitio", () => {
    expect(fittingTabs({ widths: JUEGOS, gap, available: 2000, moreWidth })).toBe(6);
  });

  it("el ajuste exacto cabe: nada de esconder una pestaña por el último píxel", () => {
    expect(fittingTabs({ widths: JUEGOS, gap, available: PIDEN, moreWidth })).toBe(6);
  });

  it("un píxel menos y el menú aparece — con sitio para su propio botón", () => {
    /* No se cae UNA pestaña: se caen las que hagan falta para que quepa también
       el «···». Cinco pestañas más su botón piden 621, así que con 680,9 de
       hueco entran las cinco. */
    expect(fittingTabs({ widths: JUEGOS, gap, available: PIDEN - 1, moreWidth })).toBe(5);
  });

  it("cuenta un hueco menos que pestañas cuando no hay menú", () => {
    // Tres de 100 con hueco 10: 320, no 330.
    expect(fittingTabs({ widths: [100, 100, 100], gap: 10, available: 320, moreWidth: 30 })).toBe(3);
    expect(fittingTabs({ widths: [100, 100, 100], gap: 10, available: 319, moreWidth: 30 })).toBe(2);
  });

  it("y uno de más cuando lo hay: k pestañas y el botón son k huecos", () => {
    // Dos de 100 + dos huecos de 10 + botón de 30 = 250.
    expect(fittingTabs({ widths: [100, 100, 100], gap: 10, available: 250, moreWidth: 30 })).toBe(2);
    expect(fittingTabs({ widths: [100, 100, 100], gap: 10, available: 249, moreWidth: 30 })).toBe(1);
  });

  it("una sola pestaña y su botón, en el límite", () => {
    // 100 + un hueco de 10 + botón de 30 = 140.
    expect(fittingTabs({ widths: [100, 100], gap: 10, available: 140, moreWidth: 30 })).toBe(1);
    expect(fittingTabs({ widths: [100, 100], gap: 10, available: 139, moreWidth: 30 })).toBe(0);
  });

  it("si no cabe ni una, el menú se las lleva todas", () => {
    expect(fittingTabs({ widths: [100, 100], gap: 10, available: 60, moreWidth: 36 })).toBe(0);
  });

  it("un botón más ancho que el hueco no deja nada fuera del menú", () => {
    expect(fittingTabs({ widths: [10, 10], gap: 4, available: 20, moreWidth: 200 })).toBe(0);
  });

  it("sin hueco medido se enseñan todas, que es lo que pasa en el móvil", () => {
    /* El carril está en `display: none` y quien manda es el dock de abajo. Un
       cero tratado como "no cabe nada" mandaría las seis al menú y dejaría la
       barra enseñando un «···» solitario durante un fotograma. */
    expect(fittingTabs({ widths: JUEGOS, gap, available: 0, moreWidth })).toBe(6);
    expect(fittingTabs({ widths: JUEGOS, gap, available: -20, moreWidth })).toBe(6);
    expect(fittingTabs({ widths: JUEGOS, gap, available: NaN, moreWidth })).toBe(6);
  });

  it("sin pestañas, cero", () => {
    expect(fittingTabs({ widths: [], gap, available: 500, moreWidth })).toBe(0);
  });
});
