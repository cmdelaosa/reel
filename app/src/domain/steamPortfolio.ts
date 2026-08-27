/* Las cuentas del inventario de Steam: qué vale, qué costó y qué ha entrado y
   salido de la cartera.
 *
 * Todo aquí es puro. La app lo usa para pintar y la función de ingesta lo usa
 * para normalizar lo que sube el recolector, y por eso no importa nada de
 * Supabase ni de React.
 *
 * ── La regla del signo, que es de donde salen todos los errores de esto ───
 * `amountCents` de una fila del libro se mira DESDE TU CARTERA: positivo es
 * dinero que entra en ella, negativo dinero que sale. Vender una pegatina es
 * positivo, comprarla negativo, recargar positivo, comprarte un juego negativo.
 *
 * De ahí sale la distinción que esta pantalla existe para hacer bien: el dinero
 * de la cartera de Steam NO se puede sacar. Así que una venta no es un ingreso,
 * es una reordenación, y sumar ventas con recargas da un número que no
 * significa nada. Se cuentan por separado y se llaman por su nombre. */

// ── steam money and dates ────────────────────────────────────────────────
//
// Bloque canónico. La función `steam-market` lo copia LITERAL entre estos dos
// mismos marcadores, porque corre en Deno y no puede importar de app/ — el
// mismo arreglo que airPairing y watchProviders, y por el mismo motivo: aquí no
// hay nada que merezca la pena parafrasear, y comparar los bytes es el control
// más barato que existe. Lo hace `steamPortfolio.mirror.test.ts`.
//
// Que las dos copias se separen no daría una pantalla ligeramente distinta:
// daría un dinero distinto según lo mire la app o lo escriba la ingesta.

/** "32,93€" → 3293. También "€32.93", "$1,234.56" y "1 234,56 руб.".
 *
 *  Steam no da la cifra cruda por ningún lado: devuelve el precio ya formateado
 *  en el idioma de la cuenta, así que hay que deshacer el formato sin saber cuál
 *  es ese idioma. La regla que lo consigue: el ÚLTIMO separador con exactamente
 *  dos dígitos detrás son los decimales, y cualquier otro punto o coma es de los
 *  miles.
 *
 *  Devuelve null en lo que no trae cifra, que es un caso normal y no un fallo:
 *  un objeto sin ventas recientes viene sin precio.
 *
 *  (Repetida a propósito en features/games/steamCollector.js, que se pega entero
 *  en una consola ajena y no puede importar. Si se toca una, se tocan las dos.) */
export function priceCents(text: string | number | null | undefined): number | null {
  if (typeof text === "number") return Number.isFinite(text) ? Math.round(text * 100) : null;
  if (!text) return null;
  /* El recorte de la cola no es adorno. El rublo se escribe "1 234,56 руб." y
     el punto de esa abreviatura sobrevive al primer filtro, rompe el match de
     los decimales y manda la cifra por la rama de "no tiene decimales", que
     multiplica por cien. Un precio cien veces mayor sin que nada falle: el peor
     tipo de error que puede tener una pantalla de dinero. */
  const digits = String(text).replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  if (!digits) return null;
  const m = digits.match(/[.,](\d{2})$/);
  if (!m) {
    const n = Number(digits.replace(/[.,]/g, ""));
    return Number.isFinite(n) ? n * 100 : null;
  }
  const whole = digits.slice(0, m.index).replace(/[.,]/g, "");
  const n = Number(whole || "0") * 100 + Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  ene: 0, jan: 0,
  feb: 1,
  mar: 2,
  abr: 3, apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7, aug: 7,
  sep: 8, sept: 8,
  oct: 9,
  nov: 10,
  dic: 11, dec: 11,
};

export interface RawLedgerRow {
  /** El id de fila de Steam. Estable, y es lo que hace idempotente re-volcar. */
  externalId: string;
  /** Lo que ponía en la columna de fecha: "24 ago" o "24 ago, 2023". */
  rawDate: string | null;
  /** Posición en el listado, empezando en 0 y de MÁS NUEVA a más vieja. */
  order: number;
}

/** Le pone año a las fechas del historial del mercado.
 *
 *  ── El problema ──
 *  Steam escribe "24 ago" a secas en lo del año en curso y solo pone el año en
 *  lo viejo… a veces, y según el idioma. Tomar el año actual para todo lo que no
 *  lo diga mete cuatro años de compras en este, y entonces el "realizado de
 *  2026" incluye lo de 2022 sin que nada falle.
 *
 *  ── La solución ──
 *  Las filas llegan ordenadas de más nueva a más vieja, y eso es información
 *  suficiente: recorriéndolas en ese orden, la fecha nunca puede AVANZAR. En
 *  cuanto una fila cae después de la anterior, es que ha cruzado un fin de año
 *  hacia atrás, y se le resta uno. Una fila que sí traiga año manda, y además
 *  recoloca el año de las que vengan detrás.
 *
 *  Devuelve null en lo que no se pueda leer, y el que lo llame decide: perder la
 *  fila es mejor que fecharla mal. */
export function datesWithYear(rows: RawLedgerRow[], now: Date): (string | null)[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const byId = new Map<string, string | null>();
  let year = now.getUTCFullYear();
  /* La primera fila es la más reciente, así que arranca en hoy. */
  let prev = { month: now.getUTCMonth(), day: now.getUTCDate() };

  for (const row of sorted) {
    const parsed = parseDayMonth(row.rawDate);
    if (!parsed) {
      byId.set(row.externalId, null);
      continue;
    }
    if (parsed.year !== null) {
      year = parsed.year;
    } else if (
      parsed.month > prev.month ||
      (parsed.month === prev.month && parsed.day > prev.day)
    ) {
      /* Bajando por la lista la fecha solo puede retroceder: si sube, cruzamos
         el 1 de enero hacia atrás. */
      year -= 1;
    }
    prev = { month: parsed.month, day: parsed.day };
    /* Mediodía UTC y no medianoche: la fila no trae hora, y a las 00:00 un
       cambio de zona horaria mueve el día entero. A las 12:00 no lo mueve
       ninguna. */
    byId.set(
      row.externalId,
      new Date(Date.UTC(year, parsed.month, parsed.day, 12)).toISOString(),
    );
  }
  return rows.map((r) => byId.get(r.externalId) ?? null);
}

function parseDayMonth(
  raw: string | null,
): { day: number; month: number; year: number | null } | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  const day = text.match(/\b(\d{1,2})\b/);
  const month = text.match(/[a-záéíóú]{3,4}/);
  if (!day || !month) return null;
  const m = MONTHS[month[0]] ?? MONTHS[month[0].slice(0, 3)];
  if (m === undefined) return null;
  const year = text.match(/\b(\d{4})\b/);
  return { day: Number(day[1]), month: m, year: year ? Number(year[1]) : null };
}

// ── end steam money and dates ────────────────────────────────────────────

/* ── El valor de lo que tienes ───────────────────────────────────────────── */

export interface Holding {
  appid: number;
  marketHashName: string;
  quantity: number;
}

export interface Price {
  appid: number;
  marketHashName: string;
  medianCents: number | null;
  lowestCents: number | null;
}

export interface PortfolioValue {
  /** Mediana × cantidad. Lo que vale. */
  valueCents: number;
  /** Listing más barato × cantidad: por lo que se vende hoy si tienes prisa.
   *  Casi siempre menor que el anterior, y la diferencia es la comisión más el
   *  hueco del libro de órdenes. */
  quickSellCents: number;
  itemCount: number;
  distinctItems: number;
  /** Nombres sin precio. Enseñarlo no es opcional: un total al que le faltan
   *  cuarenta objetos es un total equivocado, y sin esta cifra no hay forma de
   *  saberlo desde la pantalla. */
  missingPrices: number;
}

const key = (appid: number, name: string) => `${appid}:${name}`;

export function priceIndex(prices: Price[]): Map<string, Price> {
  return new Map(prices.map((p) => [key(p.appid, p.marketHashName), p]));
}

export function portfolioValue(holdings: Holding[], prices: Price[]): PortfolioValue {
  const index = priceIndex(prices);
  let valueCents = 0;
  let quickSellCents = 0;
  let itemCount = 0;
  let missingPrices = 0;
  for (const h of holdings) {
    itemCount += h.quantity;
    const p = index.get(key(h.appid, h.marketHashName));
    /* Sin mediana no hay valor, y aquí NO se rellena con la venta más barata:
       sustituir la cifra que falta por otra parecida es exactamente cómo un
       total incompleto pasa por completo. Se cuenta como ausente y se dice. */
    if (p?.medianCents == null) {
      missingPrices += 1;
      continue;
    }
    valueCents += p.medianCents * h.quantity;
    quickSellCents += (p.lowestCents ?? p.medianCents) * h.quantity;
  }
  return {
    valueCents,
    quickSellCents,
    itemCount,
    distinctItems: holdings.length,
    missingPrices,
  };
}

/* ── El dinero ───────────────────────────────────────────────────────────── */

export type LedgerKind =
  | "market_buy"
  | "market_sell"
  | "wallet_topup"
  | "store_purchase"
  | "refund"
  | "other";

export interface LedgerEntry {
  kind: LedgerKind;
  /** Con signo, desde tu cartera: positivo entra, negativo sale. */
  amountCents: number;
  appid?: number | null;
  marketHashName?: string | null;
  quantity?: number;
}

export interface CashFlow {
  /** De tu bolsillo a Steam. El único dinero de verdad que has puesto. */
  toppedUpCents: number;
  /** Lo que te has gastado en la tienda: juegos y demás. */
  spentInStoreCents: number;
  /** Lo que has pagado por objetos del mercado. */
  spentOnItemsCents: number;
  /** Lo que has cobrado por vender, ya con la comisión de Valve descontada. */
  earnedFromItemsCents: number;
  /** Ventas menos compras. Lo que el trapicheo ha dado o quitado, y NADA más:
   *  no es dinero que puedas sacar, es saldo de Steam. */
  realizedCents: number;
  /** Lo que has sacado de la cartera para comprar juegos, comparado con lo que
   *  metiste de tu bolsillo. Es la pregunta de "¿me he pagado juegos con las
   *  pegatinas?", y solo tiene respuesta con las dos cifras juntas. */
  storeFundedByMarketCents: number;
}

export function cashFlow(entries: LedgerEntry[]): CashFlow {
  let toppedUpCents = 0;
  let spentInStoreCents = 0;
  let spentOnItemsCents = 0;
  let earnedFromItemsCents = 0;
  for (const e of entries) {
    switch (e.kind) {
      case "wallet_topup":
        toppedUpCents += Math.abs(e.amountCents);
        break;
      case "store_purchase":
        spentInStoreCents += Math.abs(e.amountCents);
        break;
      case "market_buy":
        spentOnItemsCents += Math.abs(e.amountCents);
        break;
      case "market_sell":
        earnedFromItemsCents += Math.abs(e.amountCents);
        break;
      /* 'refund' y 'other' no entran en ninguna de las cuatro cestas a
         propósito: una devolución deshace un gasto que ya está contado y
         restarla otra vez lo contaría dos veces con el signo cambiado. Suman
         donde tienen que sumar, que es en el saldo, no aquí. */
      default:
        break;
    }
  }
  const realizedCents = earnedFromItemsCents - spentOnItemsCents;
  return {
    toppedUpCents,
    spentInStoreCents,
    spentOnItemsCents,
    earnedFromItemsCents,
    realizedCents,
    /* Cuánto de lo gastado en la tienda no salió de tu bolsillo. Cero cuando
       metiste más de lo que gastaste; nunca negativo, porque "he gastado menos
       de lo que puse" no es una deuda. */
    storeFundedByMarketCents: Math.max(0, spentInStoreCents - toppedUpCents),
  };
}

/** Lo que te costó cada objeto, por unidad y en media.
 *
 *  Media y no FIFO: para saber cuál de tres cápsulas iguales vendiste haría
 *  falta seguir el `assetid`, y el mercado de Steam no lo dice en el historial.
 *  Con objetos fungibles la media es además la respuesta correcta, no una
 *  aproximación.
 *
 *  Solo cuenta las compras. Una venta no cambia lo que te costó lo que aún
 *  tienes; cambia lo realizado, que se cuenta aparte. */
export function costBasis(entries: LedgerEntry[]): Map<string, number> {
  const spent = new Map<string, { cents: number; units: number }>();
  for (const e of entries) {
    if (e.kind !== "market_buy" || e.appid == null || !e.marketHashName) continue;
    const k = key(e.appid, e.marketHashName);
    const acc = spent.get(k) ?? { cents: 0, units: 0 };
    acc.cents += Math.abs(e.amountCents);
    acc.units += e.quantity ?? 1;
    spent.set(k, acc);
  }
  const out = new Map<string, number>();
  for (const [k, a] of spent) {
    if (a.units > 0) out.set(k, Math.round(a.cents / a.units));
  }
  return out;
}

/** Lo que has ganado o perdido con lo que TODAVÍA tienes, a precio de hoy.
 *
 *  Solo sobre los objetos de los que consta una compra: lo que llegó de una caja
 *  o de un regalo no costó nada, y meterlo con coste cero infla la ganancia con
 *  dinero que nunca existió. Se cuenta cuántos se han quedado fuera, para poder
 *  decirlo en pantalla. */
export function unrealized(
  holdings: Holding[],
  prices: Price[],
  basis: Map<string, number>,
): { gainCents: number; coveredItems: number; uncoveredItems: number } {
  const index = priceIndex(prices);
  let gainCents = 0;
  let coveredItems = 0;
  let uncoveredItems = 0;
  for (const h of holdings) {
    const k = key(h.appid, h.marketHashName);
    const cost = basis.get(k);
    const median = index.get(k)?.medianCents;
    if (cost == null || median == null) {
      uncoveredItems += 1;
      continue;
    }
    coveredItems += 1;
    gainCents += (median - cost) * h.quantity;
  }
  return { gainCents, coveredItems, uncoveredItems };
}
