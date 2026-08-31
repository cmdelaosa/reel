/* Lo que se VE de la curva del inventario: qué tramo, dónde caen las marcas del
 * eje del tiempo, y a qué punto apunta el ratón.
 *
 * Vive aquí y no dentro del componente por lo de siempre: son tres cuentas con
 * casos raros —una ventana que se queda sin puntos, un eje de trece años, un
 * ratón fuera del área de dibujo— y dentro de un SVG no se pueden probar. El
 * componente se queda con lo que es dibujo.
 *
 * `rpc_steam_value_series` NO devuelve un punto por día: uno por mes al fondo,
 * uno cada dos semanas en los últimos seis meses, y todos los días con foto
 * real. Eso manda en las tres funciones — nada de aquí puede suponer que la
 * distancia entre dos puntos seguidos sea siempre la misma. */

const DAY = 86_400_000;

export type SeriesRange = "3m" | "1y" | "all";

export const SERIES_RANGES: readonly SeriesRange[] = ["3m", "1y", "all"] as const;

/** Cuántos días atrás mira cada ventana. `all` no mira: enseña lo que haya. */
const WINDOW_DAYS: Record<SeriesRange, number | null> = {
  "3m": 91,
  "1y": 365,
  all: null,
};

/** El tramo que enseña una ventana.
 *
 *  La ventana cuelga del ÚLTIMO punto de la serie, no de hoy. Si la última foto
 *  es de hace una semana —el cron no corrió, el volcado es viejo—, contar desde
 *  hoy recortaría esa semana por arriba y «3 meses» enseñaría dos y tres
 *  cuartos sin decirlo. Colgando del último punto, «3 meses» son siempre los
 *  tres meses anteriores al dato más reciente que hay. */
export function windowSeries<T extends { day: string }>(series: T[], range: SeriesRange): T[] {
  const days = WINDOW_DAYS[range];
  if (days === null || series.length === 0) return series;
  const end = new Date(series[series.length - 1].day).getTime();
  const from = end - days * DAY;
  return series.filter((p) => new Date(p.day).getTime() >= from);
}

/** Si esa ventana da para dibujar algo.
 *
 *  Con un punto no hay línea, y el componente ya enseña «todavía no hay
 *  gráfica» cuando eso pasa — un mensaje que acusa de no haber subido el
 *  histórico y que sería mentira aquí, donde lo que falta es tramo, no datos.
 *  Así que el botón que llevaría a ese callejón no se ofrece. */
export function rangeHasCurve<T extends { day: string }>(series: T[], range: SeriesRange): boolean {
  return windowSeries(series, range).length >= 2;
}

/* Los saltos entre marcas del eje, de menos a más. Los de días para las
   ventanas cortas, los de meses en cuanto el tramo pasa de unas semanas: un
   salto fijo de días encima de trece años pondría las marcas en el 4 de marzo,
   el 18 de marzo… y ninguna en un principio de mes, que es lo único que se lee
   de un vistazo a esa escala. */
type Step = { days: number } | { months: number };

const STEPS: readonly Step[] = [
  { days: 1 },
  { days: 2 },
  { days: 3 },
  { days: 7 },
  { days: 14 },
  { months: 1 },
  { months: 2 },
  { months: 3 },
  { months: 6 },
  { months: 12 },
  { months: 24 },
  { months: 36 },
  { months: 60 },
  { months: 120 },
];

const stepDays = (s: Step) => ("days" in s ? s.days : s.months * 30.44);

/** Las marcas del eje del tiempo, en milisegundos y de vieja a nueva.
 *
 *  Se cuentan HACIA ATRÁS desde el final: la marca de la derecha cae en el
 *  último dato, que es el que uno busca, y no en un múltiplo del salto contado
 *  desde el principio —que dejaría la punta de la curva sin fecha justo donde
 *  está la cifra que la acompaña—. Con saltos de meses el ancla es el día 1 del
 *  mes del último punto, por lo mismo: las marcas caen en principios de mes.
 *
 *  `max` son intervalos, así que salen hasta `max + 1` marcas. */
export function dateTicks(fromMs: number, toMs: number, max = 7): number[] {
  if (!(toMs > fromMs)) return [fromMs];
  const span = (toMs - fromMs) / DAY;
  const step = STEPS.find((s) => span / stepDays(s) <= max) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  if ("days" in step) {
    for (let t = toMs; t >= fromMs; t -= step.days * DAY) out.push(t);
  } else {
    const end = new Date(toMs);
    let cur = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
    while (cur >= fromMs) {
      out.push(cur);
      const c = new Date(cur);
      cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() - step.months, 1);
    }
  }
  return out.reverse();
}

/** Con cuánto detalle se escribe una fecha del eje.
 *
 *  El día completo solo mientras quepa: en trece años, «14 mar 2015» siete
 *  veces es ruido, y lo que se quiere saber ahí es el año. */
export function tickUnit(fromMs: number, toMs: number): "day" | "month" | "year" {
  const span = (toMs - fromMs) / DAY;
  if (span <= 200) return "day";
  if (span <= 1200) return "month";
  return "year";
}

/** El punto más cercano a una x, para el foco del ratón.
 *
 *  Por x y no por índice: los puntos no están repartidos a distancias iguales
 *  (la serie es más densa cerca de hoy), así que dividir el ancho entre el
 *  número de puntos apuntaría a otro sitio del que se está señalando. */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const d = Math.abs(xs[i] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
