// igdb-proxy — Deno edge function. El tercer medio: videojuegos.
//
// Rutas (bajo /functions/v1/igdb-proxy):
//   GET /search?q=        → { results: TitleRow[] }
//   GET /game/:igdbId     → { title: TitleRow, episode_id: uuid|null }
//
// Las de descubrimiento (novedades, próximos, mejor valorados) llegan con las
// páginas que las piden; abrirlas ahora sería cachear cosas que nadie lee.
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
// Filas de `titles` con kind='game' (migración 0069). El id de IGDB va en
// `tmdb_id`, que es la columna mal nombrada que 0069 documenta: la identidad
// es (kind, tmdb_id), así que no choca con TMDB. El trigger de episodio
// sintético le pone su S1E1 solo, y con eso el juego entra en la biblioteca,
// el historial y el muro sin que ninguno sepa que existe.
//
// La traducción del payload vive en normalize.ts, con sus tests: aquí no se
// decide nada sobre los datos, solo se piden y se guardan.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Any, apicalypseTerm, gameRow, gameSearchRow } from "./normalize.ts";

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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  "release_dates.category",
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

const SEARCH_FIELDS = [
  "name",
  "summary",
  "cover.image_id",
  "platforms.id",
  "platforms.name",
  "total_rating",
  "rating",
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

/** Lanza trabajo sin que la respuesta lo espere. EdgeRuntime.waitUntil lo
 *  mantiene vivo después del return; sin él la plataforma mata la invocación
 *  con la promesa a medias. Idéntico al de tmdb-proxy. */
function inBackground(work: Promise<unknown>) {
  const runtime = (globalThis as Any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work.catch(() => {}));
  else work.catch(() => {});
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

  if (!gateHit(bearer)) {
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
    // GET /search?q= — búsqueda por nombre.
    //
    // `where version_parent = null` quita las ediciones (Deluxe, Game of the
    // Year, Complete), que son filas propias en IGDB y llenarían la lista con
    // cinco veces el mismo juego. Los DLC sí salen: son cosas que alguien
    // juega y puede querer apuntar, y esconderlos sería decidir por él.
    //
    // Los resultados se guardan como filas parciales, igual que hace
    // tmdb-proxy con las suyas: así abrir la ficha luego ya encuentra algo, y
    // la que ya estuviera entera no pierde lo que la búsqueda no trae.
    if (path === "/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ results: [] });

      const term = apicalypseTerm(q);
      if (!term) return json({ results: [] });

      const found = await igdb(
        "games",
        `search "${term}"; fields ${SEARCH_FIELDS}; ` +
          `where version_parent = null; limit 20;`,
      );
      if (!found.length) return json({ results: [] });

      const results = await upsertReturning(admin, found.map(gameSearchRow), "kind,tmdb_id");
      // El upsert devuelve las filas en el orden de la base, no en el de
      // relevancia que IGDB acaba de calcular. Se reordenan por el de IGDB,
      // que es lo único que sabe cuál de los cinco Zelda buscaba la persona.
      const rank = new Map(found.map((r: Any, i: number) => [r.id, i]));
      results.sort((a: Any, b: Any) => (rank.get(a.tmdb_id) ?? 99) - (rank.get(b.tmdb_id) ?? 99));

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
      if (cached) {
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
