// steam-sync — Deno edge function. Traer de Steam las horas jugadas (0074).
//
// Rutas (bajo /functions/v1/steam-sync):
//   GET  /login    → { url }   la URL de OpenID a la que mandar a la persona
//   GET  /return   → 302       la vuelta de Steam; la única sin sesión
//   POST /scan     → { import_id }   pide la biblioteca y prepara el borrador
//   POST /apply    → { applied, pending }  confirma lo marcado
//   POST /unlink   → { ok }    desenlaza la cuenta
//
// ── Por qué esta función no se parece a igdb-proxy ────────────────────────
// IGDB es de Twitch y su API va por *client credentials*: un par de
// credenciales del PROYECTO, iguales para todo el mundo. Steam es al revés en
// las dos mitades:
//
//   · La identidad es POR USUARIO. Steam no tiene OAuth; tiene OpenID 2.0, que
//     devuelve un SteamID64 y nada más. Vive en `profiles.steam_id`.
//   · La Web API key SÍ es del proyecto (`STEAM_API_KEY`), y es la que
//     convierte ese SteamID64 en una lista de juegos.
//
// ── La reja: cada ruta se defiende sola ──────────────────────────────────
// Esta función se despliega sin `verify_jwt` (ver supabase/config.toml), porque
// la vuelta de Steam es una navegación del navegador y no puede llevar la
// cabecera Authorization. Así que la sesión la comprueba el código, ruta por
// ruta: todas menos `/return` exigen un JWT válido. `/return` no lo necesita
// porque no se fía de NADA de lo que llega — quién vuelve lo dice el pagaré de
// un solo uso de `steam_link_nonces`, y que Steam firmara esos parámetros se le
// pregunta a Steam.
//
// ── Lo que la importación no hace ────────────────────────────────────────
// No toca `play_state`. `playtime_forever` es de por vida: derivar el estado de
// las horas metería en "Jugando" todo lo que abriste una tarde hace ocho años,
// y el cubo con el que decides qué jugar dejaría de servir. Lo que sí marca es
// `owned`, que es un dato distinto y tiene su propio sitio (ver merge.ts y
// app/src/domain/gameStatus.ts).
//
// ── El puente Steam↔IGDB ya existe ───────────────────────────────────────
// `titles.steam_appid` lo llena `igdb-proxy` en cada ficha desde el
// `external_games` de IGDB. Así que casar lo que ya está en el catálogo es un
// índice, no una petición. Lo que NO está se resuelve por la ruta `/by-steam`
// de igdb-proxy, y solo para lo que la persona haya marcado: en segundo plano,
// por lotes, y con su fila en `job_runs` como los crons.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authUrl, checkReturn, isValid, STEAM_OPENID, verifyBody } from "./openid.ts";
import { isConflict, minutesToWrite, parseOwnedGames, type OwnedGame } from "./merge.ts";

const STEAM_API = "https://api.steampowered.com";

/* Mismo tope que el resto de funciones del directorio: un tercero que acepta la
   conexión y no contesta dejaría el await colgado hasta que la plataforma mate
   la invocación. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/* Guarda de pared del trabajo de fondo. Todo lo que hay dentro es idempotente,
   así que lo que quede sin hacer lo recoge el siguiente intento — pero el
   `import` se queda en 'applying' y hay que cerrarlo diciendo la verdad. */
const MAX_MS = 240_000;

/* Cuántos appids se le piden a igdb-proxy de una vez. Es su tope por petición
   (STEAM_MAX allí); pasarse devuelve un 400 en vez de resolver menos. */
const RESOLVE_CHUNK = 200;

/* PostgREST corta en 1.000 filas sin avisar (config.toml → max_rows). Ninguna
   consulta de aquí pide más que esto de golpe: una biblioteca de Steam de mil
   y pico juegos existe, y una lectura truncada en silencio se leería como
   "esos juegos no los tienes". */
const PAGE = 500;

// deno-lint-ignore no-explicit-any
type Any = any;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Lanza trabajo sin que la respuesta lo espere. Idéntico al de tmdb-proxy y
 *  igdb-proxy: sin waitUntil la plataforma mata la invocación con la promesa a
 *  medias. */
function inBackground(work: Promise<unknown>) {
  const runtime = (globalThis as Any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work.catch(() => {}));
  else work.catch(() => {});
}

/* ─────────────────────────── Steam Web API ──────────────────────────────── */

/** La clave de Steam va en la QUERY STRING, y no hay alternativa: la Web API no
 *  acepta cabecera. Es exactamente la situación que con TMDB acabó con el
 *  secreto escrito en los logs, así que aquí no se registra nunca una URL —
 *  todos los errores de esta función se redactan antes de salir. */
function redact(text: string): string {
  const key = Deno.env.get("STEAM_API_KEY");
  const withoutKey = key ? text.replaceAll(key, "[STEAM_API_KEY]") : text;
  return withoutKey.replace(/key=[^&\s]+/g, "key=[redacted]");
}

/** Los juegos de una cuenta.
 *
 *  `include_played_free_games=1` porque sin él no vuelven ni el Dota ni el CS
 *  ni el Warframe, que para mucha gente son justo las horas que quería
 *  importar. `include_appinfo=1` trae el nombre: sin él la lista de confirmar
 *  serían números.
 *
 *  El perfil TIENE QUE SER PÚBLICO. Si no lo es, Steam contesta 200 con
 *  `{"response":{}}` — sin error y sin lista. Distinguirlo es cosa de
 *  parseOwnedGames, y la interfaz lo dice con todas las letras porque leído
 *  como "no tienes juegos" manda a la persona a buscar un fallo en su cuenta. */
async function ownedGames(steamId: string) {
  const key = Deno.env.get("STEAM_API_KEY");
  if (!key) throw new Error("STEAM_API_KEY not configured");

  const url = new URL(`${STEAM_API}/IPlayerService/GetOwnedGames/v1/`);
  url.searchParams.set("key", key);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("include_appinfo", "1");
  url.searchParams.set("include_played_free_games", "1");
  url.searchParams.set("format", "json");

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    // Deno mete la URL ENTERA en el mensaje del TypeError cuando `fetch` falla
    // por red, y esa URL lleva la clave.
    throw new Error(`steam fetch: ${redact(String((e as Error)?.message ?? e))}`);
  }
  // Un 401/403 aquí es la clave del proyecto, no el perfil de la persona: son
  // dos averías distintas y la interfaz las cuenta distinto.
  if (!res.ok) throw new Error(`steam ${res.status}: ${redact(await res.text())}`);
  return parseOwnedGames(await res.json());
}

/* ─────────────────────────── Sesión ─────────────────────────────────────── */

/** El usuario de la petición, o null. Un viaje a la base por petición, como en
 *  las otras funciones: aquí no hay memo porque estas rutas se llaman una vez
 *  por importación, no una por tecla. */
async function userOf(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

/* ─────────────────────────── El escaneo ─────────────────────────────────── */

interface Scanned {
  appid: number;
  steam_name: string;
  minutes: number;
  title_id: string | null;
  in_library: boolean;
  manual_minutes: number | null;
}

/** Cruza lo que dice Steam con lo que ya hay: el catálogo (`titles.steam_appid`)
 *  y tu biblioteca (`library_entries`). Ni una petición a la red. */
async function crossReference(
  admin: SupabaseClient,
  userId: string,
  games: OwnedGame[],
): Promise<Scanned[]> {
  // appid → title_id, del puente que igdb-proxy va llenando ficha a ficha.
  const titleByAppid = new Map<number, string>();
  for (const part of chunk(games.map((g) => g.appid), PAGE)) {
    const { data, error } = await admin
      .from("titles")
      .select("id, steam_appid")
      .eq("kind", "game")
      .in("steam_appid", part);
    if (error) throw new Error(`titles by appid: ${error.message}`);
    for (const row of data ?? []) titleByAppid.set(row.steam_appid, row.id);
  }

  // Y de esos, cuáles ya están en tu biblioteca y con qué horas. Se pregunta
  // por los title_id que acaban de casar y no por la biblioteca entera: es la
  // misma respuesta con una fracción de las filas.
  const entries = new Map<string, { minutes: number | null; source: string | null }>();
  for (const part of chunk([...titleByAppid.values()], PAGE)) {
    const { data, error } = await admin
      .from("library_entries")
      .select("title_id, minutes_played, minutes_source")
      .eq("user_id", userId)
      .in("title_id", part);
    if (error) throw new Error(`library_entries: ${error.message}`);
    for (const row of data ?? []) {
      entries.set(row.title_id, { minutes: row.minutes_played, source: row.minutes_source });
    }
  }

  return games.map((g) => {
    const titleId = titleByAppid.get(g.appid) ?? null;
    const current = titleId ? entries.get(titleId) ?? null : null;
    return {
      appid: g.appid,
      steam_name: g.name,
      minutes: g.minutes,
      title_id: titleId,
      in_library: Boolean(current),
      // Solo cuando hay algo que perder: es lo que la pantalla enseña como
      // "tú: 40 h · Steam: 12 h" y lo que convierte el conflicto en una
      // casilla en vez de en una cifra que desaparece.
      manual_minutes: current && isConflict(current, g.minutes) ? current.minutes ?? 0 : null,
    };
  });
}

/* ─────────────────────────── La confirmación ────────────────────────────── */

/** Escribe en la biblioteca las filas que ya tienen `title_id`.
 *
 *  DOS upserts y no uno, y la razón es de PostgREST: la lista de columnas del
 *  `on conflict do update` sale de la UNIÓN de claves de todo el lote. Si una
 *  fila lleva `minutes_played` y otra no, la que no lo lleva recibe un null —
 *  o sea, borrar las horas que esa persona escribió a mano, que es justo lo
 *  que esta rama existe para no hacer. Separadas por juego de claves, cada
 *  lote actualiza exactamente sus columnas.
 *
 *  `play_state` no aparece en ninguno de los dos: importar horas no dice en qué
 *  punto estás. */
async function writeEntries(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; minutes: number | null }[],
): Promise<number> {
  const withMinutes = rows.filter((r) => r.minutes !== null);
  const untouched = rows.filter((r) => r.minutes === null);
  let written = 0;

  if (withMinutes.length) {
    const { error } = await admin.from("library_entries").upsert(
      withMinutes.map((r) => ({
        user_id: userId,
        title_id: r.titleId,
        followed: true,
        owned: true,
        minutes_played: r.minutes,
        minutes_source: "steam",
      })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`library upsert (minutes): ${error.message}`);
    written += withMinutes.length;
  }

  if (untouched.length) {
    const { error } = await admin.from("library_entries").upsert(
      untouched.map((r) => ({
        user_id: userId,
        title_id: r.titleId,
        followed: true,
        owned: true,
      })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`library upsert (owned): ${error.message}`);
    written += untouched.length;
  }

  return written;
}

/** Le pregunta a igdb-proxy por los appids que el catálogo no conocía.
 *
 *  Va a la ruta `/by-steam` con el JWT de quien importa, en vez de hablar con
 *  IGDB desde aquí: allí están el token de Twitch y el estrangulador de las 4
 *  req/s, que son del PROYECTO y no de esta persona. Dos estranguladores que no
 *  se conocen contra un límite compartido no es un estrangulador. */
async function resolveAppids(auth: string, appids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/igdb-proxy/by-steam`;

  for (const part of chunk(appids, RESOLVE_CHUNK)) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ appids: part }),
      // Más generoso que el resto: dentro hay hasta diez peticiones a IGDB
      // espaciadas a 250 ms, más los upserts.
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`igdb-proxy by-steam ${res.status}`);
    const body = await res.json();
    for (const [appid, title] of Object.entries(body?.matches ?? {})) {
      const id = (title as Any)?.id;
      if (id) out.set(Number(appid), id as string);
    }
  }
  return out;
}

/** La URL a la que Steam devuelve a la persona, con su pagaré.
 *
 *  Se construye desde `SUPABASE_URL` y NO desde la URL de la petición. Las dos
 *  suelen coincidir, pero solo la primera es la dirección pública: si el
 *  isolate ve un host interno (una pasarela por delante, un dominio propio de
 *  funciones), el `return_to` que se le da a Steam apuntaría a un sitio al que
 *  el navegador no puede volver — y el fallo aparecería en producción y no
 *  aquí. Además, las dos mitades del ida y vuelta la calculan igual, que es lo
 *  que hace que la comprobación del `return_to` compare lo mismo. */
const returnTo = (nonce: string) =>
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/steam-sync/return?n=${nonce}`;

/* ─────────────────────────── Rutas ──────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/steam-sync/, "").replace(/\/+$/, "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    /* ── GET /return — la vuelta de Steam. La única sin sesión ──────────── */
    if (path === "/return") {
      const nonce = url.searchParams.get("n") ?? "";
      const { data: pledge } = await admin
        .from("steam_link_nonces")
        .select("*")
        .eq("nonce", nonce)
        .maybeSingle();

      // Sin pagaré no hay a quién enlazar, y no hay adónde volver: es lo único
      // que se contesta con un cuerpo en vez de con una redirección.
      if (!pledge) return json({ error: "unknown or expired link attempt" }, 400);

      // De un solo uso, y se gasta ANTES de comprobar nada: si la comprobación
      // falla, este intento está muerto igual y reintentar con los mismos
      // parámetros no puede servir.
      await admin.from("steam_link_nonces").delete().eq("nonce", nonce);
      // Y de paso, la basura de los intentos que nadie terminó.
      await admin.from("steam_link_nonces").delete().lt("expires_at", new Date().toISOString());

      const back = (status: string) => Response.redirect(
        `${pledge.return_to_origin}/games/steam?steam=${status}`,
        302,
      );

      if (Date.parse(pledge.expires_at) < Date.now()) return back("expired");

      const checked = checkReturn(url.searchParams, returnTo(nonce));
      if (!checked.ok) return back(checked.reason === "cancelled" ? "cancelled" : "invalid");

      /* Y ahora lo único que de verdad demuestra algo: preguntarle a Steam si
         esos parámetros los firmó él. Todo lo de arriba es comprobar que la
         respuesta va dirigida a nosotros; sin esto, cualquiera podría escribir
         la URL de vuelta a mano con el SteamID64 de otra persona. */
      const verify = await fetch(STEAM_OPENID, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: verifyBody(url.searchParams),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!verify.ok || !isValid(await verify.text())) return back("invalid");

      const { error } = await admin
        .from("profiles")
        .update({ steam_id: checked.steamId, steam_linked_at: new Date().toISOString() })
        .eq("id", pledge.user_id);
      // El índice único: esa cuenta de Steam ya está enlazada a otro perfil de
      // Reel. Es un caso legítimo (dos cuentas de Reel, una de Steam) y hay que
      // decirlo, no dejarlo en un 500.
      if (error) return back(error.code === "23505" ? "taken" : "error");

      return back("linked");
    }

    /* ── El resto exige sesión ──────────────────────────────────────────── */
    const userId = await userOf(req);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const auth = req.headers.get("Authorization")!;

    /* ── GET /login — a dónde mandar a la persona ───────────────────────── */
    if (path === "/login") {
      /* De dónde salió la petición lo dice la cabecera Origin, que pone el
         navegador y una página no puede falsear. Recibirlo como parámetro
         convertiría la vuelta de Steam en una redirección abierta: bastaría
         con que alguien abriera un enlace con `?origin=…` para acabar en
         cualquier sitio con aire de haber pasado por Reel. */
      const origin = req.headers.get("Origin");
      if (!origin) return json({ error: "missing origin" }, 400);

      const nonce = crypto.randomUUID().replace(/-/g, "");
      const { error } = await admin.from("steam_link_nonces").insert({
        nonce,
        user_id: userId,
        return_to_origin: origin,
      });
      if (error) throw new Error(`nonce: ${error.message}`);

      return json({ url: authUrl(returnTo(nonce)) });
    }

    /* ── POST /unlink ──────────────────────────────────────────────────── */
    if (path === "/unlink" && req.method === "POST") {
      const { error } = await admin
        .from("profiles")
        .update({ steam_id: null, steam_linked_at: null })
        .eq("id", userId);
      if (error) throw new Error(`unlink: ${error.message}`);
      // Lo ya importado se queda: son TUS horas y tu biblioteca. Desenlazar es
      // dejar de poder sincronizar, no deshacer lo sincronizado.
      return json({ ok: true });
    }

    /* ── POST /scan — pedir la lista y preparar el borrador ─────────────── */
    if (path === "/scan" && req.method === "POST") {
      const { data: profile } = await admin
        .from("profiles")
        .select("steam_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.steam_id) return json({ error: "not_linked" }, 400);

      const { data: run, error: runError } = await admin
        .from("steam_imports")
        .insert({ user_id: userId })
        .select()
        .single();
      if (runError) throw new Error(`steam_imports: ${runError.message}`);

      const fail = async (reason: string) => {
        await admin
          .from("steam_imports")
          .update({ state: "error", error: reason, finished_at: new Date().toISOString() })
          .eq("id", run.id);
        return json({ import_id: run.id, error: reason }, 200);
      };

      let result;
      try {
        result = await ownedGames(profile.steam_id);
      } catch (e) {
        console.error("steam-sync scan", redact(String(e)));
        return await fail("upstream");
      }
      // El perfil cerrado, que Steam contesta con un 200 vacío. Se distingue
      // aquí y se explica en la interfaz: es lo que separa "arregla la
      // privacidad de tu perfil" de "tu cuenta no tiene juegos".
      if (result.kind === "private") return await fail("private");

      const items = await crossReference(admin, userId, result.games);
      for (const part of chunk(items, PAGE)) {
        const { error } = await admin.from("steam_import_items").insert(
          part.map((i) => ({ ...i, import_id: run.id, user_id: userId })),
        );
        if (error) throw new Error(`steam_import_items: ${error.message}`);
      }

      await admin
        .from("steam_imports")
        .update({
          state: "ready",
          summary: {
            games: items.length,
            matched: items.filter((i) => i.title_id).length,
            in_library: items.filter((i) => i.in_library).length,
            conflicts: items.filter((i) => i.manual_minutes !== null).length,
          },
        })
        .eq("id", run.id);

      return json({ import_id: run.id });
    }

    /* ── POST /apply — confirmar lo marcado ─────────────────────────────── */
    if (path === "/apply" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const importId = String(body?.import_id ?? "");
      /* Lo marcado viaja en la petición y no está guardado: la pantalla se
         rellena una vez y se confirma una vez, y una casilla persistida es una
         casilla que hay que sincronizar. `overwrite` es la casilla de la fila
         en conflicto — por fila, no un ajuste global. */
      const picks = new Map<string, boolean>(
        (Array.isArray(body?.items) ? body.items : [])
          .filter((i: Any) => typeof i?.id === "string")
          .map((i: Any) => [i.id as string, Boolean(i.overwrite)]),
      );
      if (!importId || !picks.size) return json({ error: "nothing selected" }, 400);

      const { data: run } = await admin
        .from("steam_imports")
        .select("*")
        .eq("id", importId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!run) return json({ error: "not found" }, 404);

      const chosen: Any[] = [];
      for (const part of chunk([...picks.keys()], PAGE)) {
        const { data, error } = await admin
          .from("steam_import_items")
          .select("*")
          .eq("import_id", importId)
          .eq("user_id", userId)
          .in("id", part);
        if (error) throw new Error(`items: ${error.message}`);
        chosen.push(...(data ?? []));
      }

      const minutesFor = (item: Any) =>
        minutesToWrite(
          { minutes: item.manual_minutes, source: item.manual_minutes === null ? null : "manual" },
          item.minutes,
          picks.get(item.id) ?? false,
        );

      const ready = chosen.filter((i) => i.title_id);
      const pending = chosen.filter((i) => !i.title_id);

      const applied = await writeEntries(
        admin,
        userId,
        ready.map((i) => ({ titleId: i.title_id as string, minutes: minutesFor(i) })),
      );
      if (ready.length) {
        for (const part of chunk(ready.map((i) => i.id), PAGE)) {
          await admin.from("steam_import_items").update({ state: "applied" }).in("id", part);
        }
      }

      await admin
        .from("steam_imports")
        .update({
          state: pending.length ? "applying" : "done",
          finished_at: pending.length ? null : new Date().toISOString(),
          summary: { ...run.summary, applied, pending: pending.length },
        })
        .eq("id", importId);

      /* Lo que el catálogo no conocía se resuelve DETRÁS de la respuesta. A 4
         req/s compartidas entre todos, esperar aquí sería tener a la persona
         mirando una rueda mientras la petición se acerca al tope de la
         plataforma; y con `job_runs` queda registro de cómo fue, que es lo que
         los crons ya hacen. */
      if (pending.length) {
        inBackground(resolvePending(admin, userId, auth, importId, pending, minutesFor));
      }

      return json({ applied, pending: pending.length });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    // El detalle al log, redactado, y nunca al navegador: por aquí pasan la
    // clave de Steam y la conversación de OpenID.
    console.error("steam-sync", path, redact(String(e)));
    return json({ error: "upstream error" }, 502);
  }
});

/** El trabajo de fondo: resolver contra IGDB lo que el catálogo no tenía y
 *  escribirlo. Por lotes, y con su fila en `job_runs` pase lo que pase — un
 *  trabajo sin registro es un trabajo que puede fallar todos los días sin que
 *  nadie se entere (0029). */
async function resolvePending(
  admin: SupabaseClient,
  userId: string,
  auth: string,
  importId: string,
  pending: Any[],
  minutesFor: (item: Any) => number | null,
) {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + MAX_MS;
  let resolved = 0;
  let ok = false;
  let note: string | null = null;

  try {
    const byAppid = await resolveAppids(auth, pending.map((i) => i.appid));

    const found = pending.filter((i) => byAppid.has(i.appid));
    const lost = pending.filter((i) => !byAppid.has(i.appid));

    if (found.length && Date.now() < deadline) {
      // El title_id descubierto se guarda en la fila del borrador antes de
      // usarlo: si la escritura de abajo se cae, el siguiente intento no vuelve
      // a preguntarle a IGDB por lo mismo.
      for (const item of found) {
        await admin
          .from("steam_import_items")
          .update({ title_id: byAppid.get(item.appid), state: "applied" })
          .eq("id", item.id);
      }
      resolved = await writeEntries(
        admin,
        userId,
        found.map((i) => ({ titleId: byAppid.get(i.appid)!, minutes: minutesFor(i) })),
      );
    }

    // Demos, herramientas y juegos retirados: IGDB no los tiene fichados por su
    // appid. Se marcan y se cuentan, porque enseñar "importados 40" habiendo
    // entrado 38 es mentir en la única pantalla que la persona va a mirar.
    if (lost.length) {
      for (const part of chunk(lost.map((i) => i.id), 500)) {
        await admin.from("steam_import_items").update({ state: "unresolved" }).in("id", part);
      }
      note = `${lost.length} sin equivalente en IGDB`;
    }
    ok = true;
  } catch (e) {
    note = String((e as Error)?.message ?? e);
    console.error("steam-sync resolve", importId, note);
  }

  const { data: current } = await admin
    .from("steam_imports")
    .select("summary")
    .eq("id", importId)
    .maybeSingle();

  await admin
    .from("steam_imports")
    .update({
      state: ok ? "done" : "error",
      error: ok ? null : "resolve",
      finished_at: new Date().toISOString(),
      summary: { ...(current?.summary ?? {}), resolved, pending: 0, note },
    })
    .eq("id", importId);

  await admin.from("job_runs").insert({
    job: "steam-sync",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    summary: { import_id: importId, asked: pending.length, resolved, note },
  }).then(() => {}, () => {});
}
