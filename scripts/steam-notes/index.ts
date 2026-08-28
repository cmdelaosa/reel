/* Cron diario de las dos notas de Steam de cada juego (0089).
 *
 * ── Por qué esto es un guión y no la edge function ───────────────────────
 * Porque las notas ya las pedía igdb-proxy al abrir una ficha, y **Steam elige
 * por IP a quién le contesta**: a las edge functions de Supabase, 429 a la
 * primera; a un runner de GitHub, 200. Medido el 27-08-2026 con los precios
 * (0088) y escrito en steam-prices.yml. La consecuencia era invisible: el fallo
 * de `notasDeSteam` omite la clave, el upsert no toca la columna y la ficha se
 * abre igual — con dos huecos donde iban el porcentaje de reseñas y Metacritic.
 *
 * Y encima la importación en tanda (`fetchGamesInto`) ni lo intenta: lo que
 * entró por el inventario de Steam o por el export de InfiniteBacklog nació sin
 * notas y nadie volvía a por ellas. Este trabajo es quien vuelve.
 *
 * ── Dos peticiones por juego, y por qué se va tan despacio ───────────────
 *   store.steampowered.com/appreviews/<appid>   → % de positivas y cuántas
 *   store.steampowered.com/api/appdetails?…     → metacritic.score
 *
 * Las dos son públicas y sin clave. El límite conocido de `api/appdetails` es
 * del orden de 200 peticiones cada 5 minutos POR IP, y aquí van dos por juego,
 * así que el hueco por defecto (3 s) deja la pasada en unas 40 peticiones por
 * minuto: la mitad del techo. Ir despacio no cuesta nada — esto corre de
 * madrugada y no hay nadie esperando— y un 429 castiga durante minutos.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────
 * No toca `last_refreshed_at`. Esa marca significa «cuándo se trajo el detalle
 * de IGDB» y es la que decide si igdb-proxy sirve la caché; escribirla desde
 * aquí congelaría las fichas con lo que IGDB dijera el día del último refresco.
 * La contabilidad de este cron es `steam_notes_refreshed_at`, y solo suya.
 *
 * Variables (las pone el workflow desde los secretos del repo):
 *   SUPABASE_URL                — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — la sb_secret_…, ver docs/DEPLOY.md
 *   MAX_ITEMS                   — tope de juegos por pasada (opcional)
 *   GAP_MS                      — hueco entre juegos, en ms (opcional)
 */

import { createClient } from "@supabase/supabase-js";
import { metacriticOf, queueFor, reviewsOf, type Game } from "./lib.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/** Tope por pasada. 400 juegos a unos cuatro segundos —el hueco más lo que la
 *  tienda tarda en contestar dos veces— son unos 27 minutos, con margen dentro
 *  de los 45 del workflow. El margen no es cortesía: si el trabajo se pasa del
 *  tope, Actions lo mata y el rojo es diario, que es el rojo que nadie mira.
 *  Lo que no entre se refresca mañana, por orden de cola: primero lo que nunca
 *  ha tenido nota. */
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? 400);

/** Lo que se tarda por juego, hueco incluido: la mitad entre sus dos peticiones
 *  y la mitad antes del siguiente. Ver arriba: el techo de la tienda es del
 *  orden de 200 peticiones cada 5 minutos, y esto deja el ritmo en 40. */
const GAP_MS = Number(process.env.GAP_MS ?? 3000);

/** Cuántos juegos seguidos pueden fallar antes de dar la pasada por perdida.
 *
 *  El 429 se detecta solo y corta, pero no es la única forma que tiene la tienda
 *  de cerrar la puerta: un 403, un 503 o un DNS que no resuelve se cuentan como
 *  "este juego ha fallado" y, si es la IP la que está vetada, eso son cuarenta
 *  minutos preguntando a una pared. Veinte seguidos es mucho más de lo que da
 *  una racha normal —los fallos sueltos van repartidos— y mucho menos que la
 *  pasada entera. */
const MAX_SEGUIDOS = 20;

/** Tope por petición. Sin señal, `fetch` espera para siempre, y un solo juego
 *  colgado se llevaría por delante los 45 minutos del trabajo. */
const TIMEOUT_MS = 10_000;

/** Filas por página de lectura. PostgREST corta las lecturas en 1.000 SIN
 *  AVISAR, así que aquí no hay ningún `select` sin `range`. */
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

/** Una petición a la tienda. Devuelve el JSON, `null` si no contestó bien, y
 *  lanza `BLOQUEO` si Steam ha dicho basta — que no es "este juego falla" sino
 *  "para", y hay que cortar la pasada entera. */
const BLOQUEO = "429";

async function tienda(url: string): Promise<unknown | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) throw new Error(BLOQUEO);
  if (!res.ok) return null;
  return await res.json();
}

const startedAt = new Date().toISOString();
let escritos = 0;
let sinNota = 0;
let fallidos = 0;
let seguidos = 0;
let bloqueado = false;

const juegos = await readAll<Game>(
  (from, to) =>
    db.from("titles")
      .select("id, name, steam_appid, metacritic, steam_reviews, steam_notes_refreshed_at")
      .eq("kind", "game")
      .not("steam_appid", "is", null)
      /* Un `order` estable no es adorno: sin él PostgREST pagina sobre un orden
         que el planificador puede cambiar entre páginas, y la misma fila sale
         dos veces mientras otra no sale ninguna. */
      .order("id", { ascending: true })
      .range(from, to),
  "titles",
);

const cola = queueFor(juegos, Date.now());
const nuevos = juegos.filter((g) => !g.steam_notes_refreshed_at).length;
console.log(
  `${juegos.length} juegos con appid de Steam, ${nuevos} sin preguntar nunca, ` +
    `${cola.length} en la cola de hoy.`,
);
/* Si se recorta, se dice. Un tope silencioso deja fichas sin nota y el registro
   diciendo que todo fue bien. */
if (cola.length > MAX_ITEMS) {
  console.log(`Tope de ${MAX_ITEMS} por pasada: ${cola.length - MAX_ITEMS} se quedan para mañana.`);
}

for (const juego of cola.slice(0, MAX_ITEMS)) {
  const { appid } = juego;
  let reseñas, nota;
  try {
    /* En serie y no en paralelo, a propósito: son dos peticiones a la MISMA IP
       con el mismo límite, y dispararlas juntas es pegarle un pico de dos a un
       contador que se mide por minutos. El hueco de abajo separa juegos; este
       `await` separa las dos mitades de uno. */
    reseñas = reviewsOf(
      await tienda(
        `https://store.steampowered.com/appreviews/${appid}` +
          `?json=1&language=all&purchase_type=all&num_per_page=0`,
      ),
    );
    await sleep(GAP_MS / 2);
    nota = metacriticOf(
      await tienda(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=metacritic`),
      appid,
    );
  } catch (e) {
    if ((e as Error).message === BLOQUEO) {
      bloqueado = true;
      console.log(`Steam ha cortado tras ${escritos} juegos; el resto, mañana.`);
      break;
    }
    fallidos += 1;
    seguidos += 1;
    console.log(`  sin notas: ${juego.name} (${(e as Error).message})`);
    if (seguidos >= MAX_SEGUIDOS) {
      bloqueado = true;
      console.log(`${MAX_SEGUIDOS} juegos seguidos sin respuesta: no es el juego, es la puerta. Paro.`);
      break;
    }
    await sleep(GAP_MS / 2);
    continue;
  }

  /* Ninguna de las dos ha contestado: no se marca nada. Marcar aquí sería
     apuntar como preguntado lo que solo se ha intentado, y esa fila no volvería
     a la cabeza de la cola hasta dentro de una semana. */
  if (!reseñas.touch && !nota.touch) {
    fallidos += 1;
    seguidos += 1;
    if (seguidos >= MAX_SEGUIDOS) {
      bloqueado = true;
      console.log(`${MAX_SEGUIDOS} juegos seguidos sin respuesta: no es el juego, es la puerta. Paro.`);
      break;
    }
    await sleep(GAP_MS / 2);
    continue;
  }
  seguidos = 0;

  /* `update` y no `upsert`: cada juego escribe un juego DISTINTO de columnas
     —las que hayan contestado—, y el upsert de PostgREST manda un INSERT con la
     misma lista de columnas para toda la tanda, o sea que una clave ausente
     viajaría como null y borraría la nota buena de la fila de al lado. Y se
     escribe juego a juego, no al final: la pasada larga son treinta minutos, y
     guardarlo todo para el último segundo significa que un `cancel` en Actions
     tira media hora de peticiones ya hechas. */
  const { error } = await db
    .from("titles")
    .update({
      ...(reseñas.touch ? { steam_reviews: reseñas.value } : {}),
      ...(nota.touch ? { metacritic: nota.value } : {}),
      steam_notes_refreshed_at: new Date().toISOString(),
    })
    .eq("id", juego.id);
  if (error) throw new Error(`escribiendo ${juego.name}: ${error.message}`);

  escritos += 1;
  if (reseñas.value == null && nota.value == null) sinNota += 1;
  if (escritos % 50 === 0) console.log(`  ${escritos}/${Math.min(cola.length, MAX_ITEMS)}…`);
  await sleep(GAP_MS / 2);
}

console.log(
  `Escritos ${escritos} (${sinNota} sin ninguna de las dos notas), ` +
    `fallidos ${fallidos}${bloqueado ? ", cortado por Steam" : ""}.`,
);

/* La fila del cron, como los demás trabajos periódicos. `ok` en falso solo si no
   se escribió NADA habiendo cola: un corte a la mitad es el funcionamiento
   normal de esto, y marcarlo como fallo enseñaría a ignorar la columna. */
await db.from("job_runs").insert({
  job: "steam-notes",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  ok: escritos > 0 || cola.length === 0,
  summary: {
    games: juegos.length,
    queue: cola.length,
    asked: Math.min(cola.length, MAX_ITEMS),
    written: escritos,
    empty: sinNota,
    failed: fallidos,
    blocked: bloqueado,
  },
}).then(
  () => {},
  () => {},
);

/* Se sale con 0 aunque Steam corte: no es un fallo del trabajo, y un rojo diario
   en Actions por algo que se arregla solo mañana es un rojo que nadie mira. */
process.exit(0);
