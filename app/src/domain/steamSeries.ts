/* La curva de UN objeto, desde que lo compraste.
 *
 * Hermano pequeño de steamPortfolio.ts: aquel contesta «cuánto vale todo esto»
 * con los precios de HOY, y este «qué ha hecho esto desde que lo compré» con los
 * de cada día. Los datos salen de `steam_price_history` (la vela, global y
 * subida por el recolector: diaria en los dos últimos años y trimestral más
 * atrás) y de `steam_ledger` (tus compras y ventas).
 *
 * La curva de la CARTERA entera no está aquí: son cuarenta mil velas y se suman
 * en la base, en `rpc_steam_value_series` (migración 0092). Lo que sí está aquí
 * es la regla de cuántos tenías tal día —`heldOn`—, que es la misma que aquella
 * función escribe en SQL, y esta es la que tiene los tests. Si una de las dos
 * cambia, la otra está mal. */

/** Una vela: qué valía uno, tal día. */
export interface Candle {
  /** `YYYY-MM-DD`. */
  day: string;
  medianCents: number;
}

/** Un movimiento del libro que cambia cuántos tienes. */
export interface Move {
  day: string;
  kind: "market_buy" | "market_sell";
  quantity: number;
  /** Lo que costó (o dio) CADA unidad, en positivo. */
  unitCents: number;
}

export interface SeriesPoint {
  day: string;
  medianCents: number;
  /** Cuántos tenías ese día. */
  quantity: number;
  /** mediana × cantidad de ese día. */
  valueCents: number;
}

export interface ItemSeries {
  points: SeriesPoint[];
  /** Las compras, para clavarlas en la curva. */
  buys: Move[];
  /** El día en que empieza la curva, o null si no hay nada que dibujar. */
  since: string | null;
  /** Lo que valía uno el primer día de la curva y lo que vale el último. */
  firstCents: number | null;
  lastCents: number | null;
  /** Lo que pagaste de media por unidad, o null si no consta ninguna compra —
   *  lo que salió de una caja, de un drop o de un regalo. */
  avgBuyCents: number | null;
}

/** Cuántos tenías tal día, caminando el libro hacia atrás desde hoy.
 *
 *  La de hoy MENOS todo lo que entró después: compraste después → antes tenías
 *  menos; vendiste después → antes tenías más. Los movimientos DEL MISMO DÍA
 *  cuentan como ya ocurridos, que es lo que se ve en pantalla: el día que
 *  compras algo, ya lo tienes.
 *
 *  Lo que no puede saber, y es la misma advertencia que la de la migración 0092:
 *  lo que entró sin pasar por el mercado —una caja abierta, un drop, un
 *  intercambio— no está en el libro, así que sale como si lo hubieras tenido
 *  desde siempre. */
export function heldOn(qtyToday: number, moves: Move[], day: string): number {
  let after = 0;
  for (const m of moves) {
    if (m.day <= day) continue;
    after += m.kind === "market_buy" ? m.quantity : -m.quantity;
  }
  return qtyToday - after;
}

/** La curva de un objeto desde la primera compra.
 *
 *  Si nunca lo compraste —salió de una caja o de un drop— no hay fecha de
 *  compra que respetar y se dibuja el histórico entero: es lo único honesto que
 *  se puede decir de algo que no sabemos cuándo llegó.
 *
 *  Los días sin vela NO se rellenan. Steam solo escribe vela cuando hubo ventas,
 *  y la gráfica reparte el eje por FECHA y no por posición, así que un hueco de
 *  tres semanas se ve como lo que es: una línea larga entre dos puntos. */
export function itemSeries(
  candles: Candle[],
  moves: Move[],
  qtyToday: number,
): ItemSeries {
  const sorted = [...candles].sort((a, b) => a.day.localeCompare(b.day));
  const buys = moves
    .filter((m) => m.kind === "market_buy")
    .sort((a, b) => a.day.localeCompare(b.day));

  const since = buys.length ? buys[0].day : (sorted[0]?.day ?? null);
  const points: SeriesPoint[] = since
    ? sorted
        .filter((c) => c.day >= since)
        .map((c) => {
          const quantity = heldOn(qtyToday, moves, c.day);
          return {
            day: c.day,
            medianCents: c.medianCents,
            quantity,
            valueCents: Math.max(0, quantity) * c.medianCents,
          };
        })
    : [];

  let unitsBought = 0;
  let centsBought = 0;
  for (const b of buys) {
    unitsBought += b.quantity;
    centsBought += b.unitCents * b.quantity;
  }

  return {
    points,
    buys,
    since,
    firstCents: points[0]?.medianCents ?? null,
    lastCents: points[points.length - 1]?.medianCents ?? null,
    avgBuyCents: unitsBought > 0 ? Math.round(centsBought / unitsBought) : null,
  };
}
