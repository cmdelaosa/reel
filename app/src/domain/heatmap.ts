/* La rejilla de actividad, día a día y por medio. Puro, con pruebas al lado
   (heatmap.test.ts).

   El heatmap lleva desde 0047 contando los tres medios sin saberlo: una
   película vista y un juego terminado escriben su `watch_event` sobre el
   episodio sintético S1E1 que 0067 y 0071 les dan, y llegaban aquí sumados a
   los episodios de verdad bajo una sola palabra —"N episodios"— y un solo
   color. Este módulo es lo que rompe ese saco: cada día sabe de qué fue.

   Vive en domain y no en el componente por lo de siempre: la regla de quién
   tiñe un día empatado es una decisión de producto con esquinas, y las
   esquinas se prueban.

   Se declara `Medium` aquí, como en domain/mediumCopy y domain/tasteScope: este
   módulo es puro y sus pruebas corren sin DOM, mientras que lib/medium escribe
   `data-medium` en <html> al importarse. */

export type Medium = "tv" | "movie" | "game";

/** Una fila del RPC: cuánto se vio de UN medio en UN día.
 *
 *  `kind` es null cuando quien responde es la función vieja —`rpc_watch_heatmap`,
 *  que devuelve (día, n) y no sabe de medios—, y ese null no es un hueco a
 *  rellenar con "tv": es "no se sabe", y lo que se pinta entonces es la rejilla
 *  monocroma de siempre. Rellenarlo con series habría teñido de coral el año
 *  entero de quien solo juega, que es peor que no teñir. */
export interface HeatRow {
  day: string;
  kind: Medium | null;
  n: number;
}

/** Lo que se sabe de un día ya resuelto. */
export interface HeatDay {
  /** Todo lo del día, sumados los tres medios. Es lo que decide la intensidad. */
  total: number;
  /** Quién le pone color, o null si no se sabe de qué medio fue. */
  dominant: Medium | null;
  /** El desglose, de más a menos, para el texto del tooltip. */
  byKind: { kind: Medium; n: number }[];
}

/* El orden canónico de los medios en la app. Aquí solo se usa como ÚLTIMO
   desempate, cuando ni el recuento del día ni la rareza del año separan a dos:
   hace falta que la rejilla salga igual en dos cargas iguales, y sin un último
   criterio el orden lo decidiría el de llegada de las filas. */
const ORDER: readonly Medium[] = ["tv", "movie", "game"];

/** Los días de la ventana, resueltos: cuánto, de qué, y quién manda.
 *
 *  El empate lo gana el medio MÁS RARO de la ventana entera, no el primero de
 *  una lista fija. Ver un episodio es lo normal y terminar un juego no lo es:
 *  un martes con un episodio y un juego terminado es, para quien lo mira, el
 *  día del juego. Con un orden fijo "series primero", la rejilla de quien ve
 *  una serie a diario sale coral de enero a diciembre y el color deja de
 *  informar de nada — que es justo lo que se venía de arreglar. */
export function heatDays(rows: readonly HeatRow[]): Map<string, HeatDay> {
  // La rareza se mide sobre la ventana entera, así que hace falta una pasada
  // completa antes de poder resolver un solo día.
  const windowTotals = new Map<Medium, number>();
  for (const r of rows) {
    if (r.kind) windowTotals.set(r.kind, (windowTotals.get(r.kind) ?? 0) + r.n);
  }

  const days = new Map<string, { total: number; byKind: Map<Medium, number> }>();
  for (const r of rows) {
    if (r.n <= 0) continue;
    const acc = days.get(r.day) ?? { total: 0, byKind: new Map<Medium, number>() };
    acc.total += r.n;
    if (r.kind) acc.byKind.set(r.kind, (acc.byKind.get(r.kind) ?? 0) + r.n);
    days.set(r.day, acc);
  }

  const out = new Map<string, HeatDay>();
  for (const [day, acc] of days) {
    const byKind = [...acc.byKind.entries()]
      .map(([kind, n]) => ({ kind, n }))
      .sort((a, b) => b.n - a.n || rarity(a.kind, windowTotals) - rarity(b.kind, windowTotals) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    out.set(day, { total: acc.total, dominant: byKind[0]?.kind ?? null, byKind });
  }
  return out;
}

/** Cuánta actividad tiene ese medio en la ventana. Menos es más raro, y lo raro
 *  gana los empates. */
const rarity = (kind: Medium, totals: Map<Medium, number>): number => totals.get(kind) ?? 0;

/** El escalón de intensidad de un día, de 0 (nada) a 4 (lo más que hiciste).
 *
 *  Extraído del componente para que la regla de "un día con algo NUNCA es un
 *  día vacío" (el Math.max(1, …)) tenga dónde probarse: sin él, un día de un
 *  episodio en un año de maratones redondeaba a cero y desaparecía. */
export function heatLevel(n: number, max: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((n / Math.max(1, max)) * 4)));
}
