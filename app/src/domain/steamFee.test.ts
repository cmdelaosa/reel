import { describe, expect, it } from "vitest";
import {
  netCents,
  netLineCents,
  netOrNull,
  netTotalCents,
  netUnrealizedCents,
} from "@/domain/steamFee";

/** La regla que define el neto, escrita al derecho: lo que paga el comprador
 *  para que el vendedor reciba `net`. Si el neto que devolvemos no cumple esto,
 *  el número está mal aunque lo parezca. */
const grossFor = (net: number) =>
  net + Math.max(1, Math.floor(net * 0.05)) + Math.max(1, Math.floor(net * 0.1));

describe("netCents", () => {
  it("lo que devuelve nunca hace pagar al comprador más que el bruto", () => {
    // Desde 3, que es el suelo del mercado: con las dos comisiones mínimas, un
    // céntimo para el vendedor ya le cuesta tres al comprador, y por eso Steam
    // no deja poner nada a la venta por menos de 0,03 €.
    for (const gross of [3, 4, 7, 12, 50, 99, 100, 313, 1234, 9999, 184217]) {
      expect(grossFor(netCents(gross))).toBeLessThanOrEqual(gross);
    }
  });

  it("por debajo del suelo de 0,03 € no hay venta posible, y se dice un céntimo", () => {
    // No sale de ninguna regla de comisiones: son precios que el mercado no
    // llega a ofrecer. Un céntimo y no cero, porque cero se lee como "sin
    // precio", que la pantalla ya dice de otra forma.
    expect(netCents(1)).toBe(1);
    expect(netCents(2)).toBe(1);
  });

  it("y es el mayor que cumple eso: un céntimo más ya se pasa", () => {
    for (const gross of [4, 7, 12, 50, 99, 100, 313, 1234, 9999, 184217]) {
      expect(grossFor(netCents(gross) + 1)).toBeGreaterThan(gross);
    }
  });

  it("los cromos: el mínimo de un céntimo por comisión manda", () => {
    // Un cromo de 0,03 € deja 0,01 €, no 0,026. Es la mitad del inventario.
    expect(netCents(3)).toBe(1);
    expect(netCents(2)).toBe(1);
    expect(netCents(1)).toBe(1);
  });

  it("en lo caro se parece a dividir entre 1,15, sin llegar a serlo", () => {
    const gross = 184217;
    const net = netCents(gross);
    expect(net).toBeGreaterThan(159000);
    expect(net).toBeLessThan(161000);
  });

  it("un precio de cero o de menos no inventa un céntimo", () => {
    expect(netCents(0)).toBe(0);
    expect(netCents(-5)).toBe(0);
  });

  it("el hueco se respeta: sin precio no hay neto", () => {
    expect(netOrNull(null)).toBeNull();
    expect(netOrNull(300)).toBe(netCents(300));
  });
});

describe("netTotalCents", () => {
  /* 532 cromos de 0,03 €, que es la mitad larga de un inventario de verdad. */
  const cromos = [{ medianCents: 3, quantity: 532 }];

  it("suma unidad a unidad, no netea el total", () => {
    // Cada cromo es su propia venta y paga sus dos comisiones mínimas: cobras
    // un céntimo por cromo. Netear la suma (1596 → 1387) diría casi el triple.
    expect(netTotalCents(cromos)).toBe(532);
    expect(netCents(1596)).toBeGreaterThan(1300);
  });

  it("lo que no tiene precio no suma, igual que en bruto", () => {
    expect(
      netTotalCents([
        { medianCents: null, quantity: 4 },
        { medianCents: 6240, quantity: 2 },
      ]),
    ).toBe(netCents(6240) * 2);
  });

  it("y es exactamente la suma de sus líneas", () => {
    const lines = [
      { medianCents: 6240, quantity: 2 },
      { medianCents: 16, quantity: 9 },
      { medianCents: null, quantity: 3 },
    ];
    const uno = lines.map((l) => netLineCents(l.medianCents, l.quantity) ?? 0);
    expect(netTotalCents(lines)).toBe(uno[0] + uno[1] + uno[2]);
  });
});

describe("netUnrealizedCents", () => {
  it("la comisión se le quita a la venta, no al coste", () => {
    // Compraste a 50 lo que hoy vale 100: en bruto ganas 50, en neto 38 —
    // porque cobras 88, no porque el coste encoja.
    expect(netUnrealizedCents([{ medianCents: 100, quantity: 1, costCents: 50 }])).toBe(
      netCents(100) - 50,
    );
  });

  it("lo que no costó nada no cuenta, igual que en bruto", () => {
    // Espejo de `unrealized`: lo que salió de una caja no tiene coste, así que
    // no hay ganancia que calcular — ni en bruto ni en neto.
    expect(
      netUnrealizedCents([
        { medianCents: 100, quantity: 1, costCents: null },
        { medianCents: 100, quantity: 1 },
        { medianCents: null, quantity: 1, costCents: 20 },
      ]),
    ).toBe(0);
  });

  it("puede salir negativo, y no se maquilla", () => {
    // Lo compraste a 100 y hoy vale 100: con la comisión, pierdes.
    expect(netUnrealizedCents([{ medianCents: 100, quantity: 2, costCents: 100 }])).toBeLessThan(0);
  });
});
