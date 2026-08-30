import { describe, expect, it } from "vitest";
import {
  cashFlow,
  costBasis,
  datesWithYear,
  portfolioValue,
  priceCents,
  unrealized,
  type Holding,
  type LedgerEntry,
  type Price,
} from "@/domain/steamPortfolio";

describe("priceCents", () => {
  it("lee el formato de cada mercado sin saber cuál es", () => {
    expect(priceCents("32,93€")).toBe(3293);
    expect(priceCents("€32.93")).toBe(3293);
    expect(priceCents("$1,234.56")).toBe(123456);
    expect(priceCents("1.234,56€")).toBe(123456);
  });

  it("un precio sin decimales no se queda en céntimos", () => {
    expect(priceCents("12€")).toBe(1200);
  });

  it("el punto de 'руб.' no multiplica el precio por cien", () => {
    // La trampa de verdad de esta función. Ese punto es de la abreviatura, no
    // un separador: sobrevive al filtro de caracteres, rompe el match de los
    // decimales y manda la cifra por la rama de "no tiene decimales". El
    // resultado sería 12.345,60 € por algo que vale 1.234,56 €, sin un solo
    // error por ningún lado.
    expect(priceCents("1 234,56 руб.")).toBe(123456);
  });

  it("los tres céntimos de una caja no se pierden", () => {
    expect(priceCents("0,03€")).toBe(3);
  });

  it("lo que no trae cifra es null, que es un caso normal", () => {
    // Un objeto sin ventas recientes viene sin precio: `{"success":true}` a
    // secas. No es un fallo y no puede parecerse a un cero.
    expect(priceCents("")).toBeNull();
    expect(priceCents(null)).toBeNull();
    expect(priceCents("--")).toBeNull();
  });
});

describe("datesWithYear", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const row = (externalId: string, rawDate: string | null, order: number) => ({
    externalId,
    rawDate,
    order,
  });

  it("lo del año en curso se queda en el año en curso", () => {
    const out = datesWithYear([row("a", "24 ago", 0), row("b", "3 jul", 1)], now);
    expect(out[0]).toBe("2026-08-24T12:00:00.000Z");
    expect(out[1]).toBe("2026-07-03T12:00:00.000Z");
  });

  it("cuando la fecha sube, es que ha cruzado el fin de año hacia atrás", () => {
    // Bajando por el listado —de más nueva a más vieja— la fecha solo puede
    // retroceder. Un "20 dic" detrás de un "3 feb" es diciembre del año
    // anterior, y sin esto serían las dos del mismo año: cuatro años de
    // compras amontonados en este, y el realizado del año mintiendo.
    const out = datesWithYear(
      [row("a", "3 feb", 0), row("b", "20 dic", 1), row("c", "2 mar", 2)],
      now,
    );
    expect(out[0]).toBe("2026-02-03T12:00:00.000Z");
    expect(out[1]).toBe("2025-12-20T12:00:00.000Z");
    expect(out[2]).toBe("2025-03-02T12:00:00.000Z");
  });

  it("dos filas del mismo día no cuentan como un año nuevo", () => {
    const out = datesWithYear([row("a", "24 ago", 0), row("b", "24 ago", 1)], now);
    expect(out[0]).toBe("2026-08-24T12:00:00.000Z");
    expect(out[1]).toBe("2026-08-24T12:00:00.000Z");
  });

  it("una fila que trae año manda, y recoloca a las de detrás", () => {
    const out = datesWithYear(
      [row("a", "3 feb", 0), row("b", "20 dic, 2022", 1), row("c", "2 mar", 2)],
      now,
    );
    expect(out[1]).toBe("2022-12-20T12:00:00.000Z");
    expect(out[2]).toBe("2022-03-02T12:00:00.000Z");
  });

  it("entiende también los meses en inglés", () => {
    // La cuenta puede tener el idioma que sea, y el historial llega en ese.
    expect(datesWithYear([row("a", "24 Aug", 0)], now)[0]).toBe("2026-08-24T12:00:00.000Z");
    expect(datesWithYear([row("a", "5 Jan", 0)], now)[0]).toBe("2026-01-05T12:00:00.000Z");
  });

  it("lo ilegible sale null en vez de salir con una fecha inventada", () => {
    expect(datesWithYear([row("a", "no es una fecha", 0)], now)[0]).toBeNull();
    expect(datesWithYear([row("a", null, 0)], now)[0]).toBeNull();
  });

  it("devuelve las fechas en el orden en que le dieron las filas", () => {
    // El cálculo tiene que ir de más nueva a más vieja, pero el que llama pasa
    // lo que tiene y espera que le contesten en su mismo orden.
    const out = datesWithYear([row("b", "20 dic", 1), row("a", "3 feb", 0)], now);
    expect(out[0]).toBe("2025-12-20T12:00:00.000Z");
    expect(out[1]).toBe("2026-02-03T12:00:00.000Z");
  });

  it("una lista que no viene ordenada pierde un año por cada salto", () => {
    /* Esta prueba NO describe lo que queremos: describe lo que pasa cuando la
       premisa de arriba —la lista va ordenada por la fecha que se lee— es falsa.
       Está aquí porque esa premisa se rompió de verdad y nadie se enteró.

       Hasta el 30-08-2026 el recolector subía la fecha del ANUNCIO en vez de la
       del MOVIMIENTO. Steam ordena el historial por la segunda, así que la
       primera iba y venía —"25 feb", "28 feb", "27 feb", "28 feb"— y cada
       vaivén restaba un año. Con 12.026 filas ese libro acabó repartido desde
       1752: 8.907 filas antes de 1900 y solo 1.387 en el tramo real de 2013 a
       2026. La curva de la cartera camina el libro para saber cuántos tenías
       tal día, así que todo lo que había comprado y vendido quedaba fuera del
       dibujo por siglos, y la gráfica salía plausible.

       La función hacía lo que promete; lo que le daban, no. Estas fechas son
       reales, de la columna equivocada de esa cuenta. Si alguien vuelve a poner
       `dates[dates.length - 1]` en el recolector, esto es lo que va a pasar —y
       esta prueba es lo que le va a mandar a leer este comentario. */
    const saltarinas = ["25 feb", "28 feb", "27 feb", "28 feb"];
    const out = datesWithYear(
      saltarinas.map((d, i) => row(`r${i}`, d, i)),
      now,
    );
    expect(out.map((d) => d?.slice(0, 4))).toEqual(["2026", "2025", "2025", "2024"]);
  });
});

describe("portfolioValue", () => {
  const h = (name: string, quantity: number): Holding => ({
    appid: 730,
    marketHashName: name,
    quantity,
  });
  const p = (name: string, median: number | null, lowest: number | null): Price => ({
    appid: 730,
    marketHashName: name,
    medianCents: median,
    lowestCents: lowest,
  });

  it("multiplica por la cantidad, que es de lo que va todo esto", () => {
    const v = portfolioValue([h("Chroma 3 Case", 40)], [p("Chroma 3 Case", 3, 2)]);
    expect(v.valueCents).toBe(120);
    expect(v.itemCount).toBe(40);
    expect(v.distinctItems).toBe(1);
  });

  it("un objeto sin precio se cuenta como ausente, no como cero", () => {
    // Y sobre todo: NO se rellena con la venta más barata. Sustituir la cifra
    // que falta por otra parecida es exactamente cómo un total incompleto pasa
    // por completo, y aquí el total es la única cifra de la pantalla.
    const v = portfolioValue(
      [h("Chroma 3 Case", 10), h("Sticker | Titan (Holo) | Katowice 2014", 1)],
      [p("Chroma 3 Case", 3, 2), p("Sticker | Titan (Holo) | Katowice 2014", null, null)],
    );
    expect(v.valueCents).toBe(30);
    expect(v.missingPrices).toBe(1);
  });

  it("la venta rápida usa el listing más barato y cae a la mediana si no lo hay", () => {
    const v = portfolioValue(
      [h("A", 2), h("B", 1)],
      [p("A", 100, 80), p("B", 50, null)],
    );
    expect(v.valueCents).toBe(250);
    expect(v.quickSellCents).toBe(210);
  });

  it("un precio de otro appid con el mismo nombre no se cuela", () => {
    // Un cromo de 753 y una caja de 730 pueden llamarse igual, y valen cosas
    // distintas. La clave es appid + nombre, nunca el nombre solo.
    const v = portfolioValue(
      [{ appid: 753, marketHashName: "Chroma 3 Case", quantity: 5 }],
      [p("Chroma 3 Case", 300, 300)],
    );
    expect(v.valueCents).toBe(0);
    expect(v.missingPrices).toBe(1);
  });
});

describe("cashFlow", () => {
  const e = (kind: LedgerEntry["kind"], amountCents: number): LedgerEntry => ({
    kind,
    amountCents,
  });

  it("no mezcla el dinero de tu bolsillo con el saldo de Steam", () => {
    // La cuenta que esta pantalla existe para hacer bien. El saldo de la
    // cartera no se puede sacar, así que una venta no es un ingreso: sumar
    // ventas con recargas da un número que no significa nada.
    const c = cashFlow([
      e("wallet_topup", 2000),
      e("market_sell", 870),
      e("market_buy", -500),
      e("store_purchase", -2500),
    ]);
    expect(c.toppedUpCents).toBe(2000);
    expect(c.earnedFromItemsCents).toBe(870);
    expect(c.spentOnItemsCents).toBe(500);
    expect(c.spentInStoreCents).toBe(2500);
    expect(c.realizedCents).toBe(370);
  });

  it("dice cuánto de lo gastado en la tienda no salió de tu bolsillo", () => {
    const c = cashFlow([
      e("wallet_topup", 1000),
      e("market_sell", 2000),
      e("store_purchase", -2500),
    ]);
    expect(c.storeFundedByMarketCents).toBe(1500);
  });

  it("el mercado no paga juegos con dinero que no ha dado", () => {
    // El hueco entre lo metido y lo gastado son 1.500, pero el mercado solo ha
    // dado 400: el resto salió de otro sitio y atribuírselo es inventar.
    const c = cashFlow([
      e("wallet_topup", 1000),
      e("market_sell", 400),
      e("store_purchase", -2500),
    ]);
    expect(c.storeFundedByMarketCents).toBe(400);
  });

  it("un mercado que te ha costado dinero no ha pagado nada", () => {
    // El caso que sacó esto a la luz: realizado negativo y la pantalla diciendo
    // igualmente "el mercado te pagó 2.803 € de juegos".
    const c = cashFlow([
      e("wallet_topup", 1000),
      e("market_buy", -2000),
      e("store_purchase", -2500),
    ]);
    expect(c.realizedCents).toBe(-2000);
    expect(c.storeFundedByMarketCents).toBe(0);
  });

  it("gastar menos de lo que metiste no es una deuda", () => {
    const c = cashFlow([e("wallet_topup", 5000), e("store_purchase", -1000)]);
    expect(c.storeFundedByMarketCents).toBe(0);
  });

  it("aguanta el signo puesto al revés", () => {
    // El signo lo pone quien parsea el HTML de Steam, y ahí es fácil colarse.
    // Las cestas usan el valor absoluto: el `kind` ya dice la dirección, así
    // que una fila con el signo cambiado no resta donde debería sumar.
    expect(cashFlow([e("market_sell", -870)]).earnedFromItemsCents).toBe(870);
    expect(cashFlow([e("market_buy", 500)]).spentOnItemsCents).toBe(500);
  });

  it("una devolución no descuadra las cestas", () => {
    const c = cashFlow([e("store_purchase", -2500), e("refund", 2500)]);
    expect(c.spentInStoreCents).toBe(2500);
    expect(c.realizedCents).toBe(0);
  });

  it("un libro vacío da ceros, no NaN", () => {
    expect(cashFlow([])).toEqual({
      toppedUpCents: 0,
      spentInStoreCents: 0,
      spentOnItemsCents: 0,
      earnedFromItemsCents: 0,
      realizedCents: 0,
      storeFundedByMarketCents: 0,
    });
  });
});

describe("costBasis y unrealized", () => {
  const buy = (name: string, cents: number, quantity: number): LedgerEntry => ({
    kind: "market_buy",
    amountCents: -cents,
    appid: 730,
    marketHashName: name,
    quantity,
  });

  it("promedia las compras del mismo objeto", () => {
    const basis = costBasis([buy("Chroma 3 Case", 200, 2), buy("Chroma 3 Case", 400, 2)]);
    expect(basis.get("730:Chroma 3 Case")).toBe(150);
  });

  it("una venta no cambia lo que te costó lo que aún tienes", () => {
    const basis = costBasis([
      buy("Chroma 3 Case", 200, 2),
      { kind: "market_sell", amountCents: 900, appid: 730, marketHashName: "Chroma 3 Case", quantity: 1 },
    ]);
    expect(basis.get("730:Chroma 3 Case")).toBe(100);
  });

  it("lo que no costó nada se queda fuera de la ganancia, y se cuenta", () => {
    // Un objeto que salió de una caja o de un regalo no tiene coste. Meterlo
    // con coste cero infla la ganancia con dinero que nunca existió.
    const holdings: Holding[] = [
      { appid: 730, marketHashName: "Comprada", quantity: 2 },
      { appid: 730, marketHashName: "Caída de una caja", quantity: 1 },
    ];
    const prices: Price[] = [
      { appid: 730, marketHashName: "Comprada", medianCents: 300, lowestCents: 280 },
      { appid: 730, marketHashName: "Caída de una caja", medianCents: 5000, lowestCents: 4900 },
    ];
    const u = unrealized(holdings, prices, costBasis([buy("Comprada", 200, 2)]));
    expect(u.gainCents).toBe(400);
    expect(u.coveredItems).toBe(1);
    expect(u.uncoveredItems).toBe(1);
  });

  it("una pérdida sale negativa", () => {
    const u = unrealized(
      [{ appid: 730, marketHashName: "A", quantity: 1 }],
      [{ appid: 730, marketHashName: "A", medianCents: 100, lowestCents: 90 }],
      costBasis([buy("A", 500, 1)]),
    );
    expect(u.gainCents).toBe(-400);
  });
});
