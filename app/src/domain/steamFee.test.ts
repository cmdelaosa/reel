import { describe, expect, it } from "vitest";
import { netCents, netOrNull } from "@/domain/steamFee";

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
