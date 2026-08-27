// igdb-proxy — Deno edge function. El tercer medio: videojuegos.
//
// Rutas (bajo /functions/v1/igdb-proxy):
//   GET  /search?q=        → { results: TitleRow[] }  (dos consultas, ver la ruta)
//   GET  /game/:igdbId     → { title: TitleRow, episode_id: uuid|null }
//   GET  /discover/:pool   → { results: TitleRow[] }  (anticipated|new|popular|top-rated)
//   POST /warm             → { ok, summary }          (solo el cron)
//   POST /by-steam         → { matches: { [appid]: TitleRow } }  (0076)
//
// Las de descubrimiento son las gemelas de las cuatro de tmdb-proxy y comparten
// con ellas la tabla discover_cache; sus consultas viven en discover.ts, con
// pruebas. Aquí el TTL de 24 h y el /warm nocturno no son una optimización: son
// lo que impide que abrir Explorar consuma el presupuesto de peticiones del que
// también salen las búsquedas y las fichas de todos los demás.
//
// ── Por qué una función aparte y no una ruta más en tmdb-proxy ────────────
// Otra API, otra autenticación, otro límite de peticiones y otro despliegue.
// Meterla en tmdb-proxy —1.900 líneas ya— haría que el nombre mintiera y que
// un fallo del token de Twitch pudiera tumbar la búsqueda de series. Lo que se
// duplica a cambio son cuarenta líneas de andamio (cors, la reja de invitados,
// el cliente admin), que es lo que ya duplican entre sí las otras cinco
// funciones de este directorio.
//
// ── El token: uno solo, y es del proyecto, no de quien usa la app ─────────
// IGDB es de Twitch, así que la autenticación es el *client credentials* de
// OAuth2: un Client ID y un Client Secret registrados una vez en el portal de
// Twitch, que se cambian por un *app access token*. No hay login de usuario,
// no hay pantalla de permisos y nadie ve nunca a Twitch. Los dos secretos son
// IGDB_CLIENT_ID e IGDB_CLIENT_SECRET (ver docs/DEPLOY.md).
//
// El token dura unos 60 días y se cachea en el isolate. No se guarda en la
// base a propósito: pedirlo cuesta una petición que no cuenta para el límite
// de IGDB, y un token en una tabla es un secreto más que rotar. Un isolate
// frío paga esa petición una vez y sirve miles con ella.
//
// ── El límite es de 4 peticiones por segundo PARA TODO EL MUNDO ───────────
// No por usuario: es por Client ID, y el Client ID es del proyecto. Con TMDB
// la caché era una optimización; aquí es la única forma de que la app funcione
// con más de cuatro personas a la vez. De ahí que todo se sirva de `titles` y
// que a IGDB solo se vaya cuando no hay fila o tiene más de 24 h — el mismo
// trato que tmdb-proxy le da a /title, y por una razón más dura.
//
// El estrangulador de aquí abajo (MIN_GAP_MS) es por isolate, así que no es
// una garantía: dos isolates a la vez pueden pasarse. Es un tope de cortesía
// para que una ficha, que hace dos peticiones, no las dispare a la vez.
//
// ── Lo que se escribe ─────────────────────────────────────────────────────
// Filas de `titles` con kind='game' (migración 0071). El id de IGDB va en
// `tmdb_id`, que es la columna mal nombrada que 0071 documenta: la identidad
// es (kind, tmdb_id), así que no choca con TMDB. El trigger de episodio
// sintético le pone su S1E1 solo, y con eso el juego entra en la biblioteca,
// el historial y el muro sin que ninguno sepa que existe.
//
// La traducción del payload vive en normalize.ts, con sus tests: aquí no se
// decide nada sobre los datos, solo se piden y se guardan.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type Any,
  apicalypseTerm,
  couldBeOnSteam,
  gameRow,
  gameSearchRow,
  steamAppid,
} from "./normalize.ts";
import { GAME_TYPE_FILTER, mergeResults, rankSearch } from "./rank.ts";
import {
  anticipatedQuery,
  DISCOVER_TTL_MS,
  newReleasesQuery,
  popularQuery,
  topRatedQuery,
} from "./discover.ts";

const IGDB = "https://api.igdb.com/v4";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/* Mismo tope que tmdb-proxy y episode-refresh: un tercero que acepta la
   conexión y no contesta dejaría el await colgado hasta que la plataforma mate
   la invocación. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** 4 req/s es el límite duro de IGDB; 250 ms es exactamente ese ritmo. Por
 *  isolate, no global — ver la cabecera. */
const MIN_GAP_MS = 250;

const FRESH_MS = 24 * 3600 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-cache, server-timing",
  // POST por /warm, que es lo que manda net.http_post desde el cron, y por
  // /by-steam, que es lo que llama steam-sync.
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", ...extraHeaders },
  });

/* ─────────────────────────── El token de Twitch ─────────────────────────── */

let token: { value: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** El app access token, pedido una vez por isolate y reutilizado.
 *
 *  Se le resta un minuto a la caducidad que anuncia Twitch: la alternativa es
 *  descubrir que ha expirado a mitad de una petición de alguien.
 *
 *  Las peticiones concurrentes comparten la misma promesa. Sin eso, un isolate
 *  frío al que llegan diez peticiones a la vez pide diez tokens: ninguno
 *  invalida a los otros, así que no rompe nada, pero son diez viajes a Twitch
 *  —que tiene su propio límite en ese endpoint— para acabar guardando uno. */
function accessToken(force = false): Promise<string> {
  if (!force && token && token.expiresAt > Date.now()) return Promise.resolve(token.value);
  if (!force && inFlight) return inFlight;

  inFlight = fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchToken(): Promise<string> {
  const clientId = Deno.env.get("IGDB_CLIENT_ID");
  const clientSecret = Deno.env.get("IGDB_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("IGDB credentials not configured");

  // Las credenciales van en el CUERPO, no en la query string, y esto no es
  // cosmético. La documentación de Twitch pone el ejemplo con
  // ?client_id=…&client_secret=…, y así escrito el secreto acaba en sitios
  // donde nadie lo buscaría: cuando `fetch` falla por red, Deno mete la URL
  // ENTERA en el mensaje del TypeError — y ese mensaje se registra en los logs
  // de la función. Un corte de red momentáneo bastaría para dejar el secreto
  // escrito en claro y sin fecha de caducidad. En el cuerpo no aparece en
  // ningún mensaje de error.
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  // El cuerpo de Twitch sí entra en el mensaje: es su respuesta ("invalid
  // client" frente a "invalid client secret"), no nuestra petición, y es lo
  // que distingue un secreto mal copiado de una app mal configurada el día que
  // alguien pone esto en marcha.
  if (!res.ok) throw new Error(`twitch token ${res.status}: ${await res.text()}`);

  const body = await res.json();
  if (!body?.access_token) throw new Error("twitch token: no access_token in response");
  token = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 0) * 1000 - 60_000),
  };
  return token.value;
}

/* ─────────────────────────── Peticiones a IGDB ──────────────────────────── */

let lastCall = 0;

/** Espacia las llamadas a MIN_GAP_MS. La cola es implícita: cada llamada
 *  reserva su hueco moviendo `lastCall` antes de dormir, así que dos llamadas
 *  concurrentes en el mismo isolate salen separadas y no a la vez. */
async function throttle() {
  const now = Date.now();
  const at = Math.max(now, lastCall + MIN_GAP_MS);
  lastCall = at;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** Una consulta apicalypse. El cuerpo es el lenguaje de IGDB, no JSON.
 *
 *  Un 401 se reintenta UNA vez con token nuevo: un isolate que lleva semanas
 *  vivo puede tener uno caducado aunque las cuentas digan que no (Twitch puede
 *  revocarlo), y ese caso se arregla solo. Cualquier otro estado sube. */
async function igdb(endpoint: string, query: string, retry = true): Promise<Any[]> {
  await throttle();
  const res = await fetch(`${IGDB}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": Deno.env.get("IGDB_CLIENT_ID")!,
      "Authorization": `Bearer ${await accessToken()}`,
      "Accept": "application/json",
    },
    body: query,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (res.status === 401 && retry) {
    await accessToken(true);
    return igdb(endpoint, query, false);
  }

  // 429 — el límite de 4 req/s. Con MIN_GAP_MS un isolate solo no puede
  // pasarse, pero el límite es del Client ID y los isolates son varios: dos a
  // la vez bastan. Sin este reintento, lo que ve la persona es una búsqueda
  // rota (502) porque otra persona estaba buscando al mismo tiempo, y eso será
  // más frecuente cuanta más gente use la app — justo al revés de lo que
  // debería. Un respiro y otra pasada lo convierten en medio segundo de más.
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS * 2));
    return igdb(endpoint, query, false);
  }

  if (!res.ok) throw new Error(`igdb ${endpoint} ${res.status}: ${await res.text()}`);
  return await res.json();
}

/* Los campos de una ficha. Se piden explícitos y no `*` porque `*` no expande
   referencias: sin `platforms.name` la columna llegaría como una lista de ids.

   Las expansiones de dos niveles (involved_companies.company.name,
   release_dates.date_format.format) son las que la propia documentación de
   IGDB usa de ejemplo. La de date_format es la que sobrevive al día en que
   retiren el enum `category` — se piden las dos y normalize.ts prefiere la
   nueva. */
const DETAIL_FIELDS = [
  "name",
  "summary",
  "cover.image_id",
  "artworks.image_id",
  "screenshots.image_id",
  "genres.name",
  "platforms.id",
  "platforms.name",
  "release_dates.platform",
  "release_dates.date",
  "release_dates.d",
  "release_dates.m",
  "release_dates.y",
  // `date_format` y no `category`: el enum viejo está deprecado y, comprobado
  // contra la API, ya no se devuelve ni pidiéndolo. La expansión trae el `id`
  // junto al `format` sin pedirlo, que es el respaldo de normalize.ts.
  "release_dates.date_format.format",
  "involved_companies.developer",
  "involved_companies.publisher",
  "involved_companies.company.name",
  "game_status.status",
  "total_rating",
  "total_rating_count",
  "rating",
  "hypes",
  "external_games.category",
  "external_games.uid",
  "external_games.external_game_source.name",
].join(",");

/* `hypes` y `total_rating_count` no se pintan en ningún sitio: son lo que
   rankSearch necesita para ordenar. Sin ellos la popularidad sale 0 en todas
   las filas y el reordenado se queda en nada —silenciosamente, que es lo peor
   de esa clase de fallo—. */
const SEARCH_FIELDS = [
  "name",
  "summary",
  "cover.image_id",
  "platforms.id",
  "platforms.name",
  "total_rating",
  "total_rating_count",
  "rating",
  "hypes",
].join(",");

/* ─────────────────────────── Base de datos ──────────────────────────────── */

async function upsertReturning(admin: SupabaseClient, rows: Any, onConflict: string) {
  const { data, error } = await admin.from("titles").upsert(rows, { onConflict }).select();
  if (error) throw new Error(`titles upsert: ${error.message}`);
  return data ?? [];
}

const freshWithin = (at: string | null | undefined) =>
  !!at && Date.now() - Date.parse(at) < FRESH_MS;

/** Los tiempos para terminárselo, de su propio endpoint. Best-effort: un juego
 *  sin datos —o el endpoint caído— no puede impedir que la ficha se abra, y
 *  normalize.ts omite la columna cuando no llega nada, sin vaciar lo que ya
 *  hubiera. */
async function timeToBeat(igdbId: number): Promise<Any | null> {
  try {
    const rows = await igdb(
      "game_time_to_beats",
      `fields hastily,normally,completely,count; where game_id = ${igdbId};`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Trae la ficha de IGDB y la escribe. Devuelve la fila guardada. */
async function refreshGame(admin: SupabaseClient, igdbId: number) {
  const [detail] = await igdb("games", `fields ${DETAIL_FIELDS}; where id = ${igdbId};`);
  if (!detail) return null;
  const [row] = await upsertReturning(admin, gameRow(detail, await timeToBeat(igdbId)), "kind,tmdb_id");
  return row ?? null;
}

/* ──────────────── Del appid de Steam al juego de IGDB (0076) ────────────── */

/** Cuántos appids se preguntan de una vez. Cada tanda cuesta DOS peticiones
 *  —una a external_games y otra a games— así que el tamaño es lo que separa
 *  "trescientos juegos en cuatro segundos" de "trescientos juegos en dos
 *  minutos", que es lo que costaría preguntar de uno en uno a 4 req/s. */
const STEAM_CHUNK = 40;

/** Tope por petición. Quien tenga más appids que resolver hace varias
 *  llamadas: una sola invocación con mil appids son cincuenta peticiones a
 *  IGDB dentro de un solo `await`, y el límite es del proyecto entero. */
const STEAM_MAX = 200;

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** appid de Steam → ids de IGDB, preguntando por `external_games`.
 *
 *  Se filtra por `uid` y NO por la fuente en el `where`: el enum de fuentes es
 *  justo el que IGDB está migrando (`category` viejo, `external_game_source`
 *  nuevo), y atarse en la consulta al que hoy funciona es firmar la avería del
 *  día que retiren uno. Se piden los dos campos y decide `steamAppid`, que ya
 *  acepta las dos formas y es lo que llena `titles.steam_appid` en cada ficha.
 *
 *  El precio de no filtrar es que vuelven también los uid iguales de GOG o de
 *  Epic; son cuatro filas por tanda y se descartan aquí.
 *
 *  Devuelve TODOS los candidatos de cada appid y no el primero, que es lo que
 *  hacía. Un appid puede aparecer colgado de dos juegos —IGDB tiene el 374900,
 *  el ABC Murders de 2016, también en la ficha del de 2009, que es exclusivo de
 *  Nintendo DS—, y quedarse con el que llegara antes es echarlo a suertes: el
 *  27-ago-2026 salió cara y la importación metió en la biblioteca un juego de
 *  DS que nadie tiene en Steam. Quien elige es la ruta, que para entonces ya
 *  tiene las plataformas de cada candidato (`couldBeOnSteam`). */
async function igdbIdsForAppids(appids: number[]): Promise<Map<number, number[]>> {
  const found = new Map<number, number[]>();
  for (const part of chunk(appids, STEAM_CHUNK)) {
    // `uid = "570" | uid = "730" | …`: la forma con OR es la que la gramática
    // de apicalypse garantiza para un campo de texto. Una lista entre
    // paréntesis funciona con ids numéricos y no está documentada para uid.
    const where = part.map((a) => `uid = "${a}"`).join(" | ");
    let rows: Any[];
    try {
      rows = await igdb(
        "external_games",
        `fields game,uid,category,external_game_source.name; where (${where}); limit 500;`,
      );
    } catch (e) {
      // Una tanda que falla no puede tumbar a las demás: lo que no se resuelva
      // se queda como pendiente y el siguiente intento lo recoge.
      console.error("igdb-proxy by-steam externals", e);
      continue;
    }
    for (const r of rows) {
      const appid = steamAppid([r]);
      const gameId = Number(r?.game?.id ?? r?.game);
      if (appid && Number.isInteger(gameId) && gameId > 0) {
        const list = found.get(appid);
        if (!list) found.set(appid, [gameId]);
        else if (!list.includes(gameId)) list.push(gameId);
      }
    }
  }
  return found;
}

/** Las fichas de esos juegos, guardadas en `titles`.
 *
 *  Sin `game_time_to_beats`, que es una petición POR JUEGO: trescientos juegos
 *  serían trescientas peticiones para llenar una barra de progreso que aún no
 *  se ve. `gameRow` omite la columna cuando no llega nada (no la vacía), así
 *  que el primer día que alguien abra la ficha la rellena por su cuenta. */
async function fetchGamesInto(admin: SupabaseClient, igdbIds: number[]): Promise<Map<number, Any>> {
  const byIgdbId = new Map<number, Any>();
  for (const part of chunk(igdbIds, STEAM_CHUNK)) {
    let details: Any[];
    try {
      details = await igdb(
        "games",
        `fields ${DETAIL_FIELDS}; where id = (${part.join(",")}); limit ${STEAM_CHUNK};`,
      );
    } catch (e) {
      console.error("igdb-proxy by-steam details", e);
      continue;
    }
    if (!details.length) continue;
    const saved = await upsertReturning(admin, details.map((d: Any) => gameRow(d, null)), "kind,tmdb_id");
    for (const row of saved) byIgdbId.set(row.tmdb_id, row);
  }
  return byIgdbId;
}

/** Lanza trabajo sin que la respuesta lo espere. EdgeRuntime.waitUntil lo
 *  mantiene vivo después del return; sin él la plataforma mata la invocación
 *  con la promesa a medias. Idéntico al de tmdb-proxy. */
function inBackground(work: Promise<unknown>) {
  const runtime = (globalThis as Any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work.catch(() => {}));
  else work.catch(() => {});
}

/* ─────────────────────── Descubrimiento (Explorar) ──────────────────────── */

/* Las cuatro rejillas de Explorar. Lo caro de cada una no son los datos —las
   filas viven en `titles` en cuanto se han visto una vez— sino AVERIGUAR EL
   ORDEN, que es una petición a IGDB de las cuatro por segundo que tiene el
   proyecto entero. Así que lo que se cachea es la lista ordenada de ids, que es
   exactamente lo que tmdb-proxy cachea de las suyas, y en la misma tabla.
   `discover_cache.tmdb_ids` guarda aquí ids de IGDB: la misma columna mal
   nombrada que `titles.tmdb_id`, documentada por 0071 y por la misma razón —
   renombrarla sería reescribir las cuatro rutas de series y las cuatro de cine
   para que la fila diga en voz alta lo que este comentario ya dice.

   La clave lleva el prefijo `game-` porque la tabla es compartida y un id de
   IGDB no significa nada contra una lista de TMDB. */

/* Un Map y no un objeto literal, y no es cosmético: con un objeto,
   `POOLS[pool]` encuentra lo que hay en Object.prototype, y "constructor" pasa
   el `[a-z-]+` de la ruta. /discover/constructor se colaba por el 404, llegaba
   a construir una consulta que no era una cadena y acababa en una petición a
   IGDB destinada a fallar — gastando, sin caché que lo pare, una de las cuatro
   peticiones por segundo que tiene el proyecto entero. Un Map no tiene
   prototipo que consultar. */
const POOLS = new Map<string, (nowMs: number) => string>([
  ["anticipated", (n) => anticipatedQuery(SEARCH_FIELDS, n)],
  ["new", (n) => newReleasesQuery(SEARCH_FIELDS, n)],
  ["popular", () => popularQuery(SEARCH_FIELDS)],
  ["top-rated", () => topRatedQuery(SEARCH_FIELDS)],
]);

async function readDiscoverCache(admin: SupabaseClient, key: string): Promise<number[] | null> {
  const { data } = await admin
    .from("discover_cache")
    .select("tmdb_ids, cached_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.cached_at).getTime() >= DISCOVER_TTL_MS) return null;
  const ids = (data.tmdb_ids ?? []).map(Number);
  return ids.length > 0 ? ids : null;
}

async function writeDiscoverCache(admin: SupabaseClient, key: string, ids: number[]) {
  // Una lista vacía no se cachea nunca: solo pasa cuando IGDB está fallando, y
  // recordar el fallo 24 h convierte un tropiezo en una pestaña muerta.
  if (ids.length === 0) return;
  await admin.from("discover_cache").upsert(
    { cache_key: key, tmdb_ids: ids, cached_at: new Date().toISOString() },
    { onConflict: "cache_key" },
  );
}

/** Las filas de `titles` de una lista de ids de IGDB, en ESE orden.
 *
 *  El `in()` devuelve lo que la base tenga a mano, no lo que se pidió, así que
 *  el orden hay que reimponerlo — el mismo cuidado que /search se toma con el
 *  suyo. Lo que falte (una fila borrada a mano) desaparece de la rejilla en vez
 *  de aparecer vacía. */
async function gamesInOrder(admin: SupabaseClient, ids: number[]): Promise<Any[]> {
  if (ids.length === 0) return [];
  const { data } = await admin.from("titles").select("*").eq("kind", "game").in("tmdb_id", ids);
  const byId = new Map((data ?? []).map((r: Any) => [r.tmdb_id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** El orden de una rejilla: de la caché si está fresca, y si no, de IGDB.
 *
 *  `force` es la bandera del cron: reconstruye sin mirar la frescura, porque
 *  corre con el mismo periodo que el TTL del que existe para ir por delante y
 *  una comprobación lo haría saltarse justo la caché que va a caducar. */
async function resolvePool(
  admin: SupabaseClient,
  pool: string,
  force = false,
): Promise<number[]> {
  const build = POOLS.get(pool);
  if (!build) return [];
  const key = `game-${pool}:`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }

  // mergeResults por si acaso: dos filas con el mismo id en un solo upsert dan
  // "cannot affect row a second time", que se leería como una rejilla rota.
  const found = mergeResults(await igdb("games", build(Date.now())));
  if (!found.length) return [];

  await upsertReturning(admin, found.map(gameSearchRow), "kind,tmdb_id");
  const ids = found.map((r: Any) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

/* ─────────────────────────── La reja de invitados ───────────────────────── */

/* Copiada de tmdb-proxy, memo incluido: un JWT válido cuyo dueño no ha
   canjeado invitación no puede consumir la cuota de IGDB del proyecto. Solo se
   cachea el "sí" — un "no" recién invitado tiene que poder entrar en la
   siguiente petición. */
const GATE_TTL_MS = 60_000;
const GATE_MAX_ENTRIES = 500;
const gateCache = new Map<string, number>();

function jwtExpiry(t: string): number | null {
  try {
    const payload = t.split(".")[1];
    if (!payload) return null;
    const exp = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function gateHit(t: string): boolean {
  const until = gateCache.get(t);
  if (until == null) return false;
  if (until <= Date.now()) {
    gateCache.delete(t);
    return false;
  }
  return true;
}

function rememberGate(t: string) {
  const until = Math.min(Date.now() + GATE_TTL_MS, jwtExpiry(t) ?? Infinity);
  if (until <= Date.now()) return;
  if (gateCache.size >= GATE_MAX_ENTRIES) {
    const oldest = gateCache.keys().next().value;
    if (oldest !== undefined) gateCache.delete(oldest);
  }
  gateCache.set(t, until);
}

/* ─────────────────────────── Rutas ──────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // El cron se identifica con la clave de servicio y se salta la reja: no hay
  // nadie detrás a quien invitar, y lo único que hace es reconstruir cachés.
  // Misma comprobación que tmdb-proxy, y con la misma clave.
  const isCron = bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!isCron && !gateHit(bearer)) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: invited, error: gateError } = await userClient.rpc("is_current_user_invited");
    if (gateError) return json({ error: "unauthorized" }, 401);
    if (!invited) return json({ error: "not invited" }, 403);
    rememberGate(bearer);
  }

  if (!Deno.env.get("IGDB_CLIENT_ID") || !Deno.env.get("IGDB_CLIENT_SECRET")) {
    return json({ error: "IGDB credentials not configured" }, 500);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/igdb-proxy/, "").replace(/\/+$/, "");

  try {
    // POST /by-steam — de appids de Steam a juegos del catálogo (0076).
    //
    // La usa `steam-sync` al confirmar una importación, y solo para lo que la
    // persona ha marcado y NO está ya en `titles`: el puente normal es
    // `titles.steam_appid`, que se llena solo cada vez que alguien abre una
    // ficha, y esta ruta es lo que queda cuando ese puente no existe todavía.
    //
    // Vive aquí y no en steam-sync porque aquí está IGDB: el token de Twitch,
    // el estrangulador de 4 req/s y la traducción del payload. Meter una
    // segunda conversación con IGDB en otra función sería tener dos
    // estranguladores que no se conocen contra un límite que es del proyecto.
    if (path === "/by-steam") {
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      const body = await req.json().catch(() => null);
      const appids = [
        ...new Set(
          (Array.isArray(body?.appids) ? body.appids : [])
            .map((a: Any) => Number(a))
            .filter((a: number) => Number.isInteger(a) && a > 0 && a <= 2_147_483_647),
        ),
      ] as number[];
      if (!appids.length) return json({ matches: {} });
      if (appids.length > STEAM_MAX) return json({ error: `max ${STEAM_MAX} appids` }, 400);

      // Lo que ya está en el catálogo no se le pregunta a IGDB. En una segunda
      // sincronización esto es casi todo.
      const { data: known } = await admin
        .from("titles")
        .select("*")
        .eq("kind", "game")
        .in("steam_appid", appids);

      const matches: Record<string, Any> = {};
      for (const row of known ?? []) matches[String(row.steam_appid)] = row;

      const missing = appids.filter((a) => !(String(a) in matches));
      if (missing.length) {
        const igdbIds = await igdbIdsForAppids(missing);
        const rows = await fetchGamesInto(admin, [
          ...new Set([...igdbIds.values()].flat()),
        ]);
        for (const [appid, candidates] of igdbIds) {
          /* De los candidatos, el primero que PUEDA estar en Steam. Con uno solo
             —el caso normal— esto es lo de siempre; con dos es lo que separa el
             juego que tienes del homónimo de consola al que IGDB le colgó el
             mismo appid. Y si ninguno puede, no hay match: quien llama lo marca
             como no resuelto y lo dice, que es mejor que meter en tu biblioteca
             un juego que no es. */
          const row = candidates
            .map((id) => rows.get(id))
            .find((r) => r && couldBeOnSteam(r.platforms, r.first_air_date));
          if (row) matches[String(appid)] = row;
        }
      }

      // Lo que no aparezca en `matches` es un appid que IGDB no conoce por su
      // `external_games`: pasa con demos, con herramientas y con juegos
      // retirados. Quien llama lo marca como no resuelto y lo dice; callarlo
      // sería enseñar "importados 40" habiendo entrado 38.
      return json({ matches });
    }

    // POST /warm — solo el cron. Reconstruye las cuatro rejillas antes de que
    // nadie mire, que aquí importa más que en tmdb-proxy: allí el primero que
    // abría Explorar después de las 24 h pagaba unos segundos, y aquí paga
    // CUATRO peticiones del presupuesto de cuatro por segundo del proyecto
    // entero — que es el mismo del que sale cada búsqueda y cada ficha que
    // cualquier otra persona esté abriendo en ese momento.
    //
    // En serie y no en paralelo, por lo mismo que las de tmdb-proxy: son el
    // consumidor más pesado de la cuota y lanzarlas juntas es cómo un límite de
    // peticiones convierte cuatro cachés calientes en cuatro frías. Nadie está
    // esperando esta respuesta.
    if (path === "/warm") {
      if (!isCron) return json({ error: "unauthorized" }, 401);
      const startedAt = new Date().toISOString();
      const summary: Record<string, number | string> = {};
      let ok = true;
      for (const pool of POOLS.keys()) {
        try {
          summary[pool] = (await resolvePool(admin, pool, true)).length;
        } catch (e) {
          ok = false;
          // El mensaje NO se copia tal cual, por lo mismo que el catch de abajo:
          // un error de esta función puede arrastrar la respuesta de Twitch al
          // pedir el token, que es la conversación donde viven las credenciales
          // del proyecto — y esta fila de job_runs se queda guardada.
          console.error("igdb-proxy warm", pool, e);
          summary[pool] = "error";
        }
      }
      await admin.from("job_runs").insert({
        job: "igdb-warm",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok,
        summary,
      }).then(() => {}, () => {});
      return json({ ok, summary }, ok ? 200 : 500);
    }

    // GET /discover/:pool — anticipated | new | popular | top-rated.
    //
    // Una sola ruta para las cuatro y no cuatro rutas casi iguales: lo único
    // que las distingue es la consulta, y esa ya vive en discover.ts con sus
    // pruebas. Un nombre que no esté en POOLS es un 404 y no una rejilla vacía:
    // "no existe esa pestaña" y "esa pestaña no tiene nada" son cosas distintas.
    const mPool = path.match(/^\/discover\/([a-z-]+)$/);
    if (mPool) {
      const pool = mPool[1];
      if (!POOLS.has(pool)) return json({ error: "not found" }, 404);
      const ids = await resolvePool(admin, pool);
      return json({ results: await gamesInOrder(admin, ids) });
    }

    // GET /search?q= — búsqueda por nombre.
    //
    // Dos filtros en el WHERE, y los dos quitan cosas que no son juegos:
    // `version_parent = null` las ediciones (Deluxe, Game of the Year), que
    // son filas propias en IGDB y llenarían la lista con cinco veces lo mismo;
    // GAME_TYPE_FILTER los Season, Update, Bundle y Mod. Que ese segundo vaya
    // AQUÍ y no al recibir es la mitad del arreglo — ver rank.ts: filtrando
    // después, "mario kart" se quedaba sin un solo resultado.
    //
    // El orden lo pone rankSearch, no IGDB. Los resultados se guardan como
    // filas parciales, igual que hace tmdb-proxy con las suyas: así abrir la
    // ficha luego ya encuentra algo, y la que ya estuviera entera no pierde lo
    // que la búsqueda no trae.
    if (path === "/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ results: [] });

      const term = apicalypseTerm(q);
      if (!term) return json({ results: [] });

      /* DOS consultas, y hacen falta las dos. Ninguna sola sirve:
         `search` casa palabras COMPLETAS. "mario kar" y "zeld" devuelven
         cero resultados, y en un buscador que responde mientras tecleas eso
         significa que la mitad de las teclas dicen "no existe" — que se lee
         como "este juego no está en el catálogo", no como "sigue escribiendo".
         `name ~ *"…"*` es una coincidencia de subcadena y sí acierta con lo
         escrito a medias, pero es SENSIBLE A LOS ACENTOS: con "pokemon" se
         pierde todos los Pokémon oficiales, que IGDB escribe "Pokémon", y
         devuelve una lista de fan games. `search` sí los encuentra.
         Medido el 24-ago-2026 sobre ocho términos.
         La de nombre va ordenada por votos para que su ventana de 15 sea la
         de los quince más conocidos que casan, y no quince cualesquiera. */
      /* A la vez, y con las DOS a prueba de fallos. El estrangulador las separa
         igual (reserva su hueco antes de dormir), así que lanzarlas juntas no
         se salta el límite y ahorra un viaje de red entero.

         Cada una cae por su cuenta: si `~` deja de funcionar el día que IGDB
         toque el operador, la búsqueda sigue existiendo con la mitad de
         relevancia, y al revés. Lo que NO se hace es tragarse las dos y
         devolver una lista vacía — "no hay resultados" y "no he podido
         preguntar" son cosas distintas, y confundirlas es exactamente lo que
         hacía que este bug se viera como un catálogo incompleto en vez de como
         una avería. */
      const [byName, byRelevance] = await Promise.all([
        igdb(
          "games",
          `fields ${SEARCH_FIELDS}; where name ~ *"${term}"* & version_parent = null & ` +
            `${GAME_TYPE_FILTER}; sort total_rating_count desc; limit 15;`,
        ).catch((e: unknown) => e as Error),
        igdb(
          "games",
          `search "${term}"; fields ${SEARCH_FIELDS}; ` +
            `where version_parent = null & ${GAME_TYPE_FILTER}; limit 15;`,
        ).catch((e: unknown) => e as Error),
      ]);
      if (byName instanceof Error && byRelevance instanceof Error) throw byName;

      const found = mergeResults(
        Array.isArray(byName) ? byName : [],
        Array.isArray(byRelevance) ? byRelevance : [],
      );
      if (!found.length) return json({ results: [] });

      // Se corta DESPUÉS de ordenar: recortar antes dejaría fuera al que la
      // popularidad iba a poner primero.
      const ranked = rankSearch(found, q).slice(0, 20);
      const results = await upsertReturning(admin, ranked.map(gameSearchRow), "kind,tmdb_id");
      // El upsert devuelve las filas en el orden de la base, no en el que
      // acaba de decidir rankSearch, así que hay que reimponerlo. El `??
      // Number.MAX_SAFE_INTEGER` es para lo que no debería pasar: una fila
      // devuelta que no estaba en la petición se va al final en vez de
      // colarse la primera, que es lo que hacía un 99 con listas de 20.
      const order = new Map(ranked.map((r: Any, i: number) => [r.id, i]));
      results.sort((a: Any, b: Any) =>
        (order.get(a.tmdb_id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.tmdb_id) ?? Number.MAX_SAFE_INTEGER)
      );

      return json({ results }, 200, { "X-Cache": "MISS" });
    }

    // GET /game/:igdbId — la ficha.
    //
    // Cache-first, igual que /title y /movie: fresca se sirve sin tocar IGDB,
    // rancia se sirve YA y se revalida por detrás, y solo la que no existe
    // espera a la red. Con 4 req/s compartidas entre todos, esto no es una
    // optimización sino el motivo de que la ficha se abra en un tiempo
    // razonable cuando hay más de una persona usando la app.
    const detail = path.match(/^\/game\/(\d+)$/);
    if (detail) {
      const igdbId = Number(detail[1]);
      // `\d+` acepta cuarenta dígitos, y `titles.tmdb_id` es un int4: sin este
      // tope, /game/99999999999999999999 llegaba hasta el upsert y salía como
      // un 502 (error del servidor) en vez de un 404, que es lo que es.
      if (!Number.isSafeInteger(igdbId) || igdbId < 1 || igdbId > 2_147_483_647) {
        return json({ error: "not found" }, 404);
      }

      const { data: cached } = await admin
        .from("titles")
        .select("*, episodes(id)")
        .eq("kind", "game")
        .eq("tmdb_id", igdbId)
        .maybeSingle();

      if (cached && freshWithin(cached.last_refreshed_at)) {
        return json({ title: cached, episode_id: cached.episodes?.[0]?.id ?? null }, 200, {
          "X-Cache": "HIT",
        });
      }
      // Rancia se sirve YA y se revalida por detrás — pero solo si de verdad
      // hubo un detalle alguna vez. `last_refreshed_at` es lo que lo distingue:
      // lo escribe gameRow y NO gameSearchRow, así que una fila que solo ha
      // pasado por el buscador lo tiene a null. Servirla como rancia era
      // enseñar la ficha sin fecha de salida, sin plataformas por fecha y sin
      // tiempos — un Silksong salido en 2025 con un "TBA" enorme — y solo se
      // arreglaba al volver a abrirla. Sin detalle previo se espera a la red,
      // que es lo que tmdb-proxy hace con lo nunca cacheado.
      if (cached?.last_refreshed_at) {
        inBackground(refreshGame(admin, igdbId));
        return json({ title: cached, episode_id: cached.episodes?.[0]?.id ?? null }, 200, {
          "X-Cache": "STALE",
        });
      }

      const row = await refreshGame(admin, igdbId);
      if (!row) return json({ error: "not found" }, 404);

      // El episodio sintético lo acaba de crear el trigger, en la misma
      // transacción del upsert pero fuera del RETURNING — de ahí la segunda
      // lectura, que es un índice y no un escaneo.
      const { data: episode } = await admin
        .from("episodes")
        .select("id")
        .eq("title_id", row.id)
        .eq("season_number", 1)
        .eq("episode_number", 1)
        .maybeSingle();

      return json({ title: row, episode_id: episode?.id ?? null }, 200, { "X-Cache": "MISS" });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    // El detalle va al log y NO al navegador. tmdb-proxy devuelve el mensaje
    // entero al cliente, y aquí no se copia esa costumbre a propósito: los
    // mensajes de error de esta función pueden arrastrar la respuesta de
    // Twitch al pedir el token, que es la conversación en la que viven las
    // credenciales del proyecto. Quien depura tiene el log; quien mira la
    // pestaña de red, no.
    console.error("igdb-proxy", path, e);
    return json({ error: "upstream error" }, 502);
  }
});
