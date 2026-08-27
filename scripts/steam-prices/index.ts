/* Cron diario de los precios del mercado de Steam (0085).
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

const batch: Record<string, unknown>[] = [];
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
      failed += 1;
      continue;
    }
    const p = (await res.json()) as Record<string, unknown>;
    batch.push({
      appid: item.appid,
      market_hash_name: item.name,
      currency: CURRENCY,
      /* Un objeto sin ventas recientes devuelve `{"success":true}` pelado, y eso
         se guarda como null CON su `fetched_at`: es una respuesta, no un fallo,
         y sin la marca de tiempo volvería a preguntarse cada noche para siempre. */
      lowest_cents: priceCents(p.lowest_price as string),
      median_cents: priceCents(p.median_price as string),
      volume: volumeOf(p.volume),
      source: "server",
      fetched_at: new Date().toISOString(),
    });
    refreshed += 1;
    if (refreshed % 100 === 0) console.log(`  ${refreshed}/${Math.min(queue.length, MAX_ITEMS)}…`);
  } catch (e) {
    failed += 1;
    console.log(`  sin precio: ${item.name} (${(e as Error).message})`);
  }
  await sleep(GAP_MS);
}

for (let i = 0; i < batch.length; i += PAGE) {
  const { error } = await db
    .from("steam_market_prices")
    .upsert(batch.slice(i, i + PAGE), { onConflict: "appid,market_hash_name,currency" });
  if (error) throw new Error(`escribiendo precios: ${error.message}`);
}

console.log(`Refrescados ${refreshed}, fallidos ${failed}${blocked ? ", cortado por Steam" : ""}.`);

/* La fila del cron, como los demás trabajos periódicos. `ok` en falso solo si no
   se trajo NADA habiendo cola: un corte a la mitad es el funcionamiento normal
   de esto y marcarlo como fallo enseñaría a ignorar la columna. */
await db.from("job_runs").insert({
  job: "steam-prices",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  ok: refreshed > 0 || queue.length === 0,
  summary: { asked: Math.min(queue.length, MAX_ITEMS), refreshed, failed, blocked, queue: queue.length },
}).then(
  () => {},
  () => {},
);

/* Se sale con 0 aunque Steam corte: no es un fallo del trabajo, y un rojo diario
   en Actions por algo que se arregla solo mañana es un rojo que nadie mira. */
process.exit(0);
