import { describe, expect, it } from "vitest";
import { heldOn, itemSeries, type Candle, type Move } from "@/domain/steamSeries";

const buy = (day: string, quantity = 1, unitCents = 100): Move => ({
  day,
  kind: "market_buy",
  quantity,
  unitCents,
});
const sell = (day: string, quantity = 1, unitCents = 100): Move => ({
  day,
  kind: "market_sell",
  quantity,
  unitCents,
});
const candle = (day: string, medianCents: number): Candle => ({ day, medianCents });

describe("heldOn", () => {
  it("sin movimientos, siempre lo de hoy", () => {
    /* El caso de este usuario: la última compra fue hace dos años y desde
       entonces nada. Todo ese tramo es exacto, no aproximado. */
    expect(heldOn(3, [], "2024-01-01")).toBe(3);
  });

  it("una compra posterior resta hacia atrás", () => {
    const moves = [buy("2025-06-01", 2)];
    expect(heldOn(5, moves, "2025-05-31")).toBe(3);
    expect(heldOn(5, moves, "2025-06-02")).toBe(5);
  });

  it("el día de la compra ya cuenta como tuyo", () => {
    expect(heldOn(1, [buy("2025-06-01")], "2025-06-01")).toBe(1);
  });

  it("y el día de la venta ya no", () => {
    /* La otra mitad de la misma regla, y la que se elige mal al reescribirla.
       La comprobación 3 de supabase/sql-checks/0092_serie_reconstruida.sql
       afirma esto mismo del lado de la base: si las dos se separan, la ficha de
       un objeto y la curva de la cartera contarían distinto el mismo día. */
    expect(heldOn(0, [sell("2025-06-01")], "2025-06-01")).toBe(0);
    expect(heldOn(0, [sell("2025-06-01")], "2025-05-31")).toBe(1);
  });

  it("una venta posterior suma hacia atrás", () => {
    /* Lo vendiste, así que antes lo tenías. Hoy no está en el inventario y su
       cantidad de hoy es cero. */
    expect(heldOn(0, [sell("2025-06-01", 2)], "2025-05-01")).toBe(2);
  });

  it("compras y ventas mezcladas se compensan", () => {
    const moves = [buy("2025-03-01", 4), sell("2025-09-01", 1)];
    expect(heldOn(3, moves, "2025-02-01")).toBe(0);
    expect(heldOn(3, moves, "2025-05-01")).toBe(4);
    expect(heldOn(3, moves, "2025-12-01")).toBe(3);
  });

  it("lo que salió de una caja sale como tuyo desde siempre", () => {
    /* Es la limitación, escrita como test para que se vea que es una decisión y
       no un descuido: sin fila en el libro, no hay forma de saber cuándo llegó
       y la reconstrucción lo cuenta desde el principio. */
    expect(heldOn(1, [], "2015-01-01")).toBe(1);
  });
});

describe("itemSeries", () => {
  const candles = [
    candle("2025-01-01", 100),
    candle("2025-06-01", 150),
    candle("2025-12-01", 210),
  ];

  it("empieza el día de la primera compra y no antes", () => {
    const s = itemSeries(candles, [buy("2025-06-01", 1, 140)], 1);
    expect(s.since).toBe("2025-06-01");
    expect(s.points.map((p) => p.day)).toEqual(["2025-06-01", "2025-12-01"]);
    expect(s.firstCents).toBe(150);
    expect(s.lastCents).toBe(210);
  });

  it("sin compra dibuja el histórico entero", () => {
    const s = itemSeries(candles, [], 1);
    expect(s.since).toBe("2025-01-01");
    expect(s.points).toHaveLength(3);
    expect(s.avgBuyCents).toBeNull();
  });

  it("la cantidad de cada punto es la de ese día", () => {
    const s = itemSeries(candles, [buy("2025-01-01", 1, 90), buy("2025-12-01", 2, 200)], 3);
    expect(s.points.map((p) => p.quantity)).toEqual([1, 1, 3]);
    expect(s.points.map((p) => p.valueCents)).toEqual([100, 150, 630]);
  });

  it("el coste medio pondera por unidades, no por compras", () => {
    /* Una compra de 3 a 100 y otra de 1 a 200 son 125 de media, no 150. Es la
       misma regla que costBasis en steamPortfolio.ts. */
    const s = itemSeries(candles, [buy("2025-01-01", 3, 100), buy("2025-06-01", 1, 200)], 4);
    expect(s.avgBuyCents).toBe(125);
  });

  it("las velas desordenadas no descolocan la curva", () => {
    const s = itemSeries([candle("2025-12-01", 210), candle("2025-01-01", 100)], [], 1);
    expect(s.points.map((p) => p.day)).toEqual(["2025-01-01", "2025-12-01"]);
  });

  it("sin velas no hay curva", () => {
    const s = itemSeries([], [buy("2025-06-01")], 1);
    expect(s.points).toEqual([]);
    expect(s.firstCents).toBeNull();
  });

  it("una cantidad negativa no resta valor", () => {
    /* Vendiste más de lo que compraste porque parte vino de cajas. El pasado se
       queda corto, pero no se pinta en negativo. */
    const s = itemSeries(candles, [sell("2025-06-01", 5)], 0);
    expect(s.points.every((p) => p.valueCents >= 0)).toBe(true);
  });
});
