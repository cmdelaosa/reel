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
 *   STEAM_GAP_MS                — hueco entre peticiones en ms (opcional)
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

/** Quiénes somos, y sin esto Steam no contesta.
 *
 *  El `fetch` de Node manda `User-Agent: node` y a ese Steam le devuelve 429
 *  SIEMPRE desde un runner de GitHub: 10 de 10, medido el 29-08-2026. Con este
 *  agente, 200 de 200 en el mismo segundo y desde la misma IP.
 *
 *  Y no es que Steam tenga una lista de agentes buenos: `curl/8.5.0` pasó diez
 *  seguidas en una pasada y salió 429 seis veces en la siguiente, dos minutos
 *  después. Lo que encaja con las dos medidas es que el cupo va por IP Y AGENTE,
 *  y la IP de un runner la comparte medio mundo — así que los agentes comunes
 *  llegan con el cubo ya gastado por otro y uno propio llega con el suyo limpio.
 *  Por eso este dice quiénes somos de verdad en vez de imitar a un navegador:
 *  no hace falta mentir para que funcione, y una URL en el agente es lo que
 *  permite que quien mire los registros de Valve sepa a quién escribir.
 *
 *  Cambiarlo por algo genérico vuelve a romper el cron, y el síntoma será otra
 *  vez «Refrescados 0» sin ningún error.
 *
 *  Probado entero contra producción el 29-08-2026, 35 minutos seguidos:
 *  «Refrescados 500, fallidos 0, 245 velas de histórico», y ni una sola espera
 *  por 429 en toda la pasada. La noche anterior, con el agente de Node y los
 *  700 ms: «Refrescados 0, cortado por Steam». */
const UA = "Reel/1.0 (+https://reel-app.com)";

/** El hueco entre peticiones.
 *
 *  Eran 700 ms, y el comentario decía que salía de una medida. No salía de
 *  ninguna: hasta que se arregló el agente, la PRIMERA petición ya devolvía 429
 *  y no había forma de medir el ritmo. Medido de verdad el 29-08-2026, con el
 *  agente bueno y desde el runner:
 *
 *    · a 700 ms:  20 de 40, y el corte llega en la petición 21 — o sea que el
 *                 cubo son unas veinte y a ese ritmo se vacía en quince
 *                 segundos;
 *    · a 3.000 ms: 30 de 40, con cortes sueltos por el medio.
 *
 *  O sea que lo que Steam sostiene es del orden de una cada cuatro segundos.
 *  4.000 ms van por debajo de eso a propósito: esto corre de madrugada, no hay
 *  nadie esperando, y lo que cuesta caro es el 429 — que no solo pierde esa
 *  petición, sino que cierra el cubo para las siguientes. */
const GAP_MS = Number(process.env.STEAM_GAP_MS ?? 4000);

/** Cuánto se espera cuando Steam dice 429, y cuántos seguidos hacen rendirse.
 *
 *  Antes un solo 429 cortaba la pasada entera. Con el ritmo bien puesto los
 *  cortes siguen existiendo —30 de 40 en la medida, no 40 de 40—, así que
 *  rendirse al primero es tirar la noche por un tropiezo. Se espera el doble
 *  cada vez, que es lo que el cubo necesita para volver a llenarse, y solo se
 *  abandona cuando Steam dice que no cinco veces seguidas: eso ya no es un
 *  tropiezo, es que hoy no toca. */
const BACKOFF_MS = 8000;
const GIVE_UP_AFTER_429 = 5;

/** Tope por pasada. Eran 1.500, que a 700 ms cabían en 18 minutos; a 4.000 ms
 *  serían cien minutos y el workflow corta a los 45. 500 son 33 minutos de
 *  peticiones más lo que se vaya en esperas, que entra con margen.
 *
 *  Que un inventario de 608 objetos ya no quepa en una sola noche no es un
 *  problema nuevo ni una regresión: la cola va por orden de rancio, así que lo
 *  que no entra hoy es justo lo que entra primero mañana, y ningún precio se
 *  queda atrás más de dos días. */
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? 500);

/** Filas por escritura y por página de lectura. PostgREST corta las lecturas en
 *  1.000 SIN AVISAR, así que aquí no hay ningún `select` sin `range`. */
const PAGE = 500;

/** Cada cuántos precios se vuelca lo acumulado.
 *
 *  Iba con `PAGE`, y con `MAX_ITEMS` en 1.500 eso eran tres vuelcos por pasada.
 *  Al bajar el tope a 500 los dos números se igualaron y el vuelco intermedio
 *  dejó de existir: los 500 precios de la noche se quedaban en memoria hasta el
 *  `flush` final, que es exactamente lo que la cabecera de `flush` dice que no
 *  puede pasar — y ahora peor, porque la pasada dura 35 minutos en vez de 18 y
 *  un `cancel` en Actions o un tropiezo de la base los tira todos.
 *
 *  Aparte de `PAGE` y no en su lugar: uno dice cuántas filas caben en una
 *  sentencia y el otro cada cuánto se guarda, y atarlos fue el error. */
const FLUSH_EVERY = 100;

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

/** Una petición a Steam, con su espera si dice 429.
 *
 *  Devuelve la respuesta, o `null` si Steam sigue diciendo 429 después de
 *  `GIVE_UP_AFTER_429` intentos — y entonces quien llama corta la pasada.
 *
 *  El reintento es SOBRE EL MISMO OBJETO y no un salto al siguiente: la espera
 *  ya está pagada, y saltar dejaría un hueco por cada corte suelto cuando lo
 *  único que hacía falta era esperar. Antes de esto un solo 429 mataba la noche
 *  entera; con el ritmo bien puesto los cortes sueltos son normales —30 de 40 en
 *  la medida del 29-08-2026— así que rendirse al primero era tirar la pasada por
 *  un tropiezo. */
async function pedir(url: string): Promise<Response | null> {
  for (let intento = 1; intento <= GIVE_UP_AFTER_429; intento++) {
    const res = await fetch(url, {
      /* El agente es lo que decide si Steam contesta. Ver `UA` arriba: sin él,
         429 en la primera petición y todas las noches. */
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 429) return res;
    if (intento === GIVE_UP_AFTER_429) return null;
    /* El doble cada vez, que es lo que el cubo necesita para rellenarse. */
    const espera = BACKOFF_MS * 2 ** (intento - 1);
    console.log(`  Steam dice "espera" (${intento}/${GIVE_UP_AFTER_429}); ${espera / 1000}s…`);
    await sleep(espera);
  }
  return null;
}

for (const item of queue.slice(0, MAX_ITEMS)) {
  const url =
    `https://steamcommunity.com/market/priceoverview/?appid=${item.appid}` +
    `&currency=${CURRENCY}&market_hash_name=${encodeURIComponent(item.name)}`;
  try {
    const res = await pedir(url);
    if (res === null) {
      /* `pedir` ya ha esperado y reintentado lo suyo, y sigue diciendo 429. Eso
         ya no es un tropiezo: se corta la pasada y lo que quede va mañana, que
         es exactamente lo que el orden de rancio garantiza que sea lo primero. */
      blocked = true;
      console.log(`Steam sigue cortando tras ${refreshed} precios; el resto, mañana.`);
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
  if (batch.length >= FLUSH_EVERY) await flush();
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
