/* Las decisiones del cron de precios, separadas de la red y de la base para que
   se puedan probar: a quién se le pregunta, en qué orden, y cómo se lee lo que
   contesta Steam. */

/** "32,93€" → 3293. También "€32.93", "$1,234.56" y "1 234,56 руб.".
 *
 *  Copia de `priceCents` de app/src/domain/steamPortfolio.ts, y no un import:
 *  este guión vive fuera de `app/` y tiene su propio tsconfig. La lógica es la
 *  misma y la trampa también — ese punto final de "руб." rompe el match de los
 *  decimales y multiplica la cifra por cien si no se recorta. */
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

/** El volumen de 24 h, que Steam escribe con separador de miles: "1,234". */
export function volumeOf(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface Held {
  appid: number;
  market_hash_name: string;
}

export interface Known {
  appid: number;
  market_hash_name: string;
  fetched_at: string;
  source: string;
}

export interface Wanted {
  appid: number;
  name: string;
}

/** Cuándo un precio de servidor se considera rancio.
 *
 *  20 h y no 24: el cron va todos los días a la misma hora, y con el umbral
 *  clavado en 24 h la carrera se pierde por segundos —la pasada de hoy ve el
 *  precio de ayer con 23 h 59 min y no lo toca—, así que cada precio se
 *  refrescaría en días alternos. Cuatro horas de holgura lo evitan sin permitir
 *  dos pasadas útiles el mismo día. */
export const STALE_MS = 20 * 60 * 60 * 1000;

/** A quién hay que preguntarle precio, y en qué orden.
 *
 *  El orden ES la política:
 *    0. lo que no tiene precio ninguno — sin él, un objeto nuevo no sale en el
 *       total y la pantalla lo cuenta como ausente;
 *    1. lo que solo tiene un precio de cliente, provisional por definición;
 *    2. lo demás, y solo si está rancio, de más viejo a más nuevo.
 *
 *  Y lo fresco NO ENTRA. Esa es la diferencia entre una cola que se vacía y un
 *  bucle que gira: metiendo todo lo que alguien tiene, el "quedan N" no baja
 *  nunca de la cuenta total y el cron se pasa la noche volviendo a preguntar
 *  precios que trajo hace diez minutos. */
export function queueFor(held: Held[], known: Known[], now: number): Wanted[] {
  const wanted = new Map<string, Wanted>();
  for (const h of held) {
    wanted.set(`${h.appid}:${h.market_hash_name}`, {
      appid: h.appid,
      name: h.market_hash_name,
    });
  }
  const freshness = new Map<string, { at: number; source: string }>();
  for (const k of known) {
    freshness.set(`${k.appid}:${k.market_hash_name}`, {
      at: Date.parse(k.fetched_at),
      source: k.source,
    });
  }
  return [...wanted.entries()]
    .map(([key, v]) => {
      const f = freshness.get(key);
      return {
        ...v,
        /* Una `fetched_at` ilegible cuenta como el principio de los tiempos, no
           como NaN: comparar con NaN da siempre false, y esa fila se quedaría
           fuera de la cola para siempre sin que nada lo dijera. */
        at: Number.isFinite(f?.at) ? (f as { at: number }).at : 0,
        rank: !f ? 0 : f.source === "client" ? 1 : 2,
      };
    })
    .filter((x) => x.rank < 2 || now - x.at > STALE_MS)
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ appid, name }) => ({ appid, name }));
}
