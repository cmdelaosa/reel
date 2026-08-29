/* Cron diario de los precios del mercado de Steam (0088).
 *
 * ── Por qué esto es un guión y no una ruta de la edge function ────────────
 * Porque Steam elige a quién le contesta por IP, y la de las edge functions de
 * Supabase no está entre esas. Medido el 27-08-2026 contra el proyecto de
 * producción, con una fila de prueba en `steam_holdings`:
 *
 *   · desde la edge function: 429 a la primera, cero precios traídos;
 *   · desde un runner de GitHub: 5 de 5 con 200 y precios reales;
 *   · desde una IP doméstica: 12 seguidas sin un corte.
 *
 * La primera versión de esto vivía en la función y habría fallado en silencio
 * todas las noches — con `refreshed: 0` en el registro y una pantalla que se
 * queda con los precios que subió el navegador, cada vez más viejos. Así que lo
 * que necesita salir a Steam vive aquí, en el runner, y lo que necesita la clave
 * de servicio y la base sigue en la función (`/snapshot`).
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────
 * No lee inventarios. El endpoint `/inventory/…` está estrangulado por IP con
 * una mano mucho más dura que `priceoverview` —429 hasta a la primera petición
 * desde una IP doméstica limpia—, y encima `pricehistory` y `myhistory` piden la
 * cookie de sesión. Todo eso lo trae el recolector desde el navegador de la
 * persona (app/src/features/games/steamCollector.js). Lo que cambia a diario no
 * es lo que tienes: es lo que vale.
 *
 * ── Lo que sí hace desde 0092: la vela de hoy ────────────────────────────
 * Cada precio que refresca se escribe DOS veces: en `steam_market_prices`, que
 * es la foto de ahora y se pisa a sí misma, y en `steam_price_history` como la
 * vela del día. Así la curva reconstruida del inventario se mantiene sola de hoy
 * en adelante, y el recolector queda para lo único que solo él puede hacer: el
 * relleno hacia atrás. Antes de esto el histórico envejecía en cuanto uno dejaba
 * de acordarse de pasar el recolector.
 *
 * Variables (las pone el workflow desde los secretos del repo):
 *   SUPABASE_URL                — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — la sb_secret_…, ver docs/DEPLOY.md
 *   STEAM_CURRENCY              — id de moneda de Valve; 3 = EUR (opcional)
 *   MAX_ITEMS                   — tope de peticiones por pasada (opcional)
 */

import { createClient } from "@supabase/supabase-js";
import { priceCents, queueFor, volumeOf, type Held, type Known } from "./lib.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/* 3 = EUR. Es el id de moneda de Valve, no ISO 4217: Steam no convierte, así que
   esto no es un formato, es qué mercado se está mirando. */
const CURRENCY = Number(process.env.STEAM_CURRENCY ?? 3);

/** El hueco entre peticiones. 700 ms sale de la medida: el margen exacto no se
 *  conoce y el castigo del 429 dura minutos, así que ir despacio aquí no cuesta
 *  nada — esto corre de madrugada y no hay nadie esperando. */
const GAP_MS = 700;

/** Tope por pasada. 1.500 a 700 ms son unos 18 minutos, holgado dentro de los 45
 *  del workflow. Existe para que un inventario absurdo no deje el trabajo
 *  girando una hora; lo que no entre se refresca mañana, por orden de rancio. */
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? 1500);

/** Filas por escritura y por página de lectura. PostgREST corta las lecturas en
 *  1.000 SIN AVISAR, así que aquí no hay ningún `select` sin `range`. */
const PAGE = 500;

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${(error as { message: string }).message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const startedAt = new Date().toISOString();
let refreshed = 0;
let failed = 0;
let blocked = false;
/** Velas del histórico escritas esta pasada. Se cuenta aparte de `refreshed`
 *  porque no son lo mismo: un precio sin mediana se refresca y no deja vela. */
let historyWritten = 0;

const held = await readAll<Held>(
  (from, to) =>
    db.from("steam_holdings").select("appid, market_hash_name")
      .order("appid", { ascending: true })
      .order("market_hash_name", { ascending: true })
      .range(from, to),
  "steam_holdings",
);

const known = await readAll<Known>(
  (from, to) =>
    db.from("steam_market_prices").select("appid, market_hash_name, fetched_at, source")
      .eq("currency", CURRENCY)
      .order("appid", { ascending: true })
      .order("market_hash_name", { ascending: true })
      .range(from, to),
  "steam_market_prices",
);

const queue = queueFor(held, known, Date.now());
console.log(
  `${held.length} filas de inventario, ${known.length} precios guardados, ${queue.length} por refrescar.`,
);
/* Si se recorta, se dice. Un tope silencioso deja la pantalla con precios viejos
   y el registro diciendo que todo fue bien. */
if (queue.length > MAX_ITEMS) {
  console.log(`Tope de ${MAX_ITEMS} por pasada: ${queue.length - MAX_ITEMS} se quedan para mañana.`);
}

let batch: Record<string, unknown>[] = [];

/** Vuelca lo acumulado. Se llama cada tanda y no solo al final, y esa es la
 *  diferencia entre perder el trabajo y no perderlo: la pasada larga son
 *  dieciocho minutos de peticiones, y guardarlo todo para el último segundo
 *  significa que un tiempo agotado, un `cancel` en Actions o un tropiezo de la
 *  base tiran mil precios ya traídos. */
async function flush(): Promise<void> {
  if (!batch.length) return;
  const { error } = await db
    .from("steam_market_prices")
    .upsert(batch, { onConflict: "appid,market_hash_name,currency" });
  if (error) throw new Error(`escribiendo precios: ${error.message}`);

  /* La misma tanda, otra vez, como vela de HOY en el histórico.
   *
   * `steam_market_prices` es una foto que se pisa a sí misma: guarda el precio
   * de ahora y el de ayer se pierde. El histórico son las velas, y hasta 0092
   * solo las traía el recolector desde el navegador — o sea que la curva
   * envejecía en cuanto uno dejaba de pasarlo, y había que acordarse.
   *
   * Con esto el recolector queda para lo que de verdad solo él puede hacer: el
   * relleno hacia atrás, los años que ya pasaron. De hoy en adelante la curva se
   * mantiene sola, todas las noches.
   *
   * Se pisa la vela del día (sin `ignoreDuplicates`) y solo la del día: la
   * ingesta del volcado sí respeta lo que ya está escrito, pero aquí la fila que
   * se toca es la de hoy y este precio viene del cron, que es la fuente buena.
   * Si alguien subió antes hoy un precio desde su navegador, este lo sustituye.
   *
   * Un objeto sin ventas recientes viene con `median_cents` null y NO deja vela:
   * la tabla no admite nulos ahí, y una vela inventada a cero sería un desplome
   * en la curva que no ocurrió. */
  const day = new Date().toISOString().slice(0, 10);
  const candles = batch
    .filter((p) => typeof p.median_cents === "number")
    .map((p) => ({
      appid: p.appid,
      market_hash_name: p.market_hash_name,
      currency: p.currency,
      day,
      median_cents: p.median_cents,
      volume: p.volume ?? 0,
    }));
  if (candles.length) {
    const { error: e2 } = await db
      .from("steam_price_history")
      .upsert(candles, { onConflict: "appid,market_hash_name,currency,day" });
    /* No se relanza: la vela de hoy es un extra sobre el trabajo de este guión,
       que es refrescar precios. Tirar la pasada entera —y con ella los precios
       ya traídos— porque el histórico no admitió una fila sería cambiar lo
       importante por lo accesorio. Se dice en el registro y sigue. */
    if (e2) console.log(`  sin vela de histórico esta tanda: ${e2.message}`);
    else historyWritten += candles.length;
  }

  batch = [];
}

for (const item of queue.slice(0, MAX_ITEMS)) {
  const url =
    `https://steamcommunity.com/market/priceoverview/?appid=${item.appid}` +
    `&currency=${CURRENCY}&market_hash_name=${encodeURIComponent(item.name)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) {
      /* Un 429 no es "este objeto falla", es "para". Insistir alarga el bloqueo,
         así que se corta la pasada entera y lo que quede va mañana — que es
         exactamente lo que el orden de la cola garantiza que sea lo menos
         urgente. */
      blocked = true;
      console.log(`Steam ha cortado tras ${refreshed} precios; el resto, mañana.`);
      break;
    }
    if (!res.ok) {
      /* Sin `continue`: la espera de abajo tiene que correr también aquí. Con un
         `continue` en medio, una racha de respuestas malas —que es justo lo que
         pasa cuando Steam empieza a enfadarse— se convertía en una ráfaga sin
         hueco entre peticiones, o sea en la mejor forma de provocar el 429 que
         este guión existe para evitar. */
      failed += 1;
    } else {
      const p = (await res.json()) as Record<string, unknown>;
      batch.push({
        appid: item.appid,
        market_hash_name: item.name,
        currency: CURRENCY,
        /* Un objeto sin ventas recientes devuelve `{"success":true}` pelado, y
           eso se guarda como null CON su `fetched_at`: es una respuesta, no un
           fallo, y sin la marca de tiempo volvería a preguntarse cada noche
           para siempre. */
        lowest_cents: priceCents(p.lowest_price as string),
        median_cents: priceCents(p.median_price as string),
        volume: volumeOf(p.volume),
        source: "server",
        fetched_at: new Date().toISOString(),
      });
      refreshed += 1;
      if (refreshed % 100 === 0) {
        console.log(`  ${refreshed}/${Math.min(queue.length, MAX_ITEMS)}…`);
      }
    }
  } catch (e) {
    failed += 1;
    console.log(`  sin precio: ${item.name} (${(e as Error).message})`);
  }
  if (batch.length >= PAGE) await flush();
  await sleep(GAP_MS);
}

await flush();

console.log(
  `Refrescados ${refreshed}, fallidos ${failed}, ${historyWritten} velas de histórico` +
    `${blocked ? ", cortado por Steam" : ""}.`,
);

/* La fila del cron, como los demás trabajos periódicos. `ok` en falso solo si no
   se trajo NADA habiendo cola: un corte a la mitad es el funcionamiento normal
   de esto y marcarlo como fallo enseñaría a ignorar la columna. */
await db.from("job_runs").insert({
  job: "steam-prices",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  ok: refreshed > 0 || queue.length === 0,
  summary: {
    asked: Math.min(queue.length, MAX_ITEMS),
    refreshed,
    failed,
    blocked,
    queue: queue.length,
    history: historyWritten,
  },
}).then(
  () => {},
  () => {},
);

/* Se sale con 0 aunque Steam corte: no es un fallo del trabajo, y un rojo diario
   en Actions por algo que se arregla solo mañana es un rojo que nadie mira. */
process.exit(0);
