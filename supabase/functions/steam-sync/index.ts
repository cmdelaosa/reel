// steam-sync — Deno edge function. Traer de Steam las horas jugadas (0076).
//
// Rutas (bajo /functions/v1/steam-sync):
//   GET  /login    → { url }   la URL de OpenID a la que mandar a la persona
//   GET  /return   → 302       la vuelta de Steam; la única sin sesión
//   POST /confirm  → { status }  la sesión reclama lo que Steam confirmó
//   POST /scan     → { import_id }   pide la biblioteca y prepara el borrador
//   POST /apply    → { applied, pending }  confirma lo marcado
//   POST /unlink   → { ok }    desenlaza la cuenta
//
// El enlace son DOS pasos —/return y /confirm— y no uno, y eso no es ceremonia:
// quien crea el pagaré elige su `user_id`, así que si la vuelta de Steam
// escribiera directamente en `profiles`, bastaría con pasarle a alguien un
// enlace de Steam para que su cuenta acabara enlazada a TU perfil. Lo que
// decide dónde se escribe es el JWT de /confirm. Ver la migración 0076.
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
// ── Lo que la importación no DEDUCE ──────────────────────────────────────
// De las horas no sale ningún estado. `playtime_forever` es de por vida:
// derivar "Jugando" de ahí metería en la lista todo lo que abriste una tarde
// hace ocho años, y el cubo con el que decides qué jugar dejaría de servir. Lo
// que la importación marca sola es `owned`, que es un dato distinto y tiene su
// propio sitio (ver merge.ts y app/src/domain/gameStatus.ts).
//
// Lo que SÍ escribe desde 0078 es lo que la persona marca juego a juego en la
// pantalla de confirmar: `play_state`, la nota, y el watch_event de lo que dice
// haber terminado — ese último fechado con `rtime_last_played`, la última vez
// que lo jugó, y no con el día de la importación.
//
// ── El puente Steam↔IGDB ya existe ───────────────────────────────────────
// `titles.steam_appid` lo llena `igdb-proxy` en cada ficha desde el
// `external_games` de IGDB. Así que casar lo que ya está en el catálogo es un
// índice, no una petición. Lo que NO está se resuelve por la ruta `/by-steam`
// de igdb-proxy, y solo para lo que la persona haya marcado: en segundo plano,
// por lotes, y con su fila en `job_runs` como los crons.
//
// ── Las tablas del borrador ya no son solo de Steam ──────────────────────
// Desde 0082 se llaman `game_imports` y `game_import_items`, las comparte con
// `nintendo-sync`, y cada fila dice de quién es (`provider`). El appid vive en
// `external_id` como texto, porque Nintendo no tiene ningún número que poner
// ahí. Las escrituras comunes —biblioteca, notas, finales— viven en
// `_shared/game-import.ts`; aquí solo queda lo que es de Steam.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chunk,
  ID_PAGE,
  PAGE,
  writeEntries,
  writeFinished,
  writeRatings,
} from "../_shared/game-import.ts";
import { authUrl, checkReturn, isValid, STEAM_OPENID, verifyBody } from "./openid.ts";
import {
  finishedAt,
  isConflict,
  minutesToWrite,
  parseOwnedGames,
  parsePick,
  type OwnedGame,
  type Pick,
} from "./merge.ts";

const STEAM_API = "https://api.steampowered.com";

/* Mismo tope que el resto de funciones del directorio: un tercero que acepta la
   conexión y no contesta dejaría el await colgado hasta que la plataforma mate
   la invocación. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/* Cuántos appids se le piden a igdb-proxy de una vez. Es su tope por petición
   (STEAM_MAX allí); pasarse devuelve un 400 en vez de resolver menos. */
const RESOLVE_CHUNK = 200;

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
  /** El appid, como TEXTO: desde 0082 la columna es `external_id` y la
   *  comparten los dos proveedores. La conversión vive aquí y en
   *  `resolvePending`, que son los dos únicos sitios que cruzan la frontera. */
  external_id: string;
  name: string;
  minutes: number;
  title_id: string | null;
  in_library: boolean;
  manual_minutes: number | null;
  /** La última partida según Steam (0078). Se fotografía aquí porque es la
   *  fecha con la que se escribirá el watch_event de lo que marques como
   *  terminado, y la fila del borrador tiene que poder confirmarse sin volver a
   *  preguntarle a Steam. */
  last_played_at: string | null;
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
  for (const part of chunk([...titleByAppid.values()], ID_PAGE)) {
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
      external_id: String(g.appid),
      name: g.name,
      minutes: g.minutes,
      title_id: titleId,
      in_library: Boolean(current),
      // Solo cuando hay algo que perder: es lo que la pantalla enseña como
      // "tú: 40 h · Steam: 12 h" y lo que convierte el conflicto en una
      // casilla en vez de en una cifra que desaparece.
      manual_minutes: current && isConflict(current, g.minutes) ? current.minutes ?? 0 : null,
      last_played_at: g.lastPlayed,
    };
  });
}

/* ─────────────────────────── La confirmación ────────────────────────────── */

/** Le pregunta a igdb-proxy por los appids que el catálogo no conocía.
 *
 *  Va a la ruta `/by-steam` con el JWT de quien importa, en vez de hablar con
 *  IGDB desde aquí: allí están el token de Twitch y el estrangulador de las 4
 *  req/s, que son del PROYECTO y no de esta persona. Dos estranguladores que no
 *  se conocen contra un límite compartido no es un estrangulador. */
async function resolveAppids(
  auth: string,
  appids: number[],
): Promise<{ found: Map<number, string>; failedChunks: number }> {
  const found = new Map<number, string>();
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/igdb-proxy/by-steam`;
  let failedChunks = 0;

  for (const part of chunk(appids, RESOLVE_CHUNK)) {
    /* Cada tanda cae por su cuenta. Antes esto se propagaba y el `catch` de
       arriba tiraba la importación ENTERA: con cuatrocientos juegos por
       resolver, que la segunda tanda fallara descartaba también los doscientos
       que la primera ya había resuelto, y la pantalla decía "importados 0". Lo
       que no se resuelva se queda como `unresolved` y se cuenta. */
    try {
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
        if (id) found.set(Number(appid), id as string);
      }
    } catch (e) {
      failedChunks++;
      console.error("steam-sync resolve chunk", redact(String(e)));
    }
  }
  return { found, failedChunks };
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

/** Adónde se devuelve a la persona una vez Steam ha contestado.
 *
 *  Un SECRETO del proyecto (`APP_URL`) y no la cabecera `Origin` de quien pidió
 *  el pagaré. `Origin` la pone el navegador, sí — pero /login lo puede llamar
 *  cualquiera con sesión y con curl, y entonces el destino de la redirección lo
 *  elige quien la fabricó: una redirección abierta que además pasa por una
 *  pantalla de Steam, que es el mejor aval que puede tener un enlace de
 *  phishing. Con un secreto no hay entrada del atacante en esta decisión. */
const appUrl = () => (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");

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
    //
    // Y por eso NO escribe en `profiles`. Lo único que hace es dejar en el
    // pagaré el SteamID64 que Valve ha confirmado; quien lo reclama es la
    // sesión, en /confirm. El motivo entero está en la migración 0076: quien
    // creó el pagaré eligió su `user_id`, así que escribir aquí sería dejar que
    // un tercero decidiera en qué perfil aterriza la cuenta de Steam de otro.
    if (path === "/return") {
      const home = appUrl();
      // Sin APP_URL no hay adónde devolver a nadie, y adivinarlo desde la
      // petición es justo lo que este secreto existe para no hacer.
      if (!home) return json({ error: "APP_URL not configured" }, 500);
      const back = (status: string, extra = "") =>
        Response.redirect(`${home}/games/steam?steam=${status}${extra}`, 302);

      const nonce = url.searchParams.get("n") ?? "";
      const { data: pledge } = await admin
        .from("steam_link_nonces")
        .select("*")
        .eq("nonce", nonce)
        .maybeSingle();

      // La basura de los intentos que nadie terminó, de paso.
      await admin.from("steam_link_nonces").delete().lt("expires_at", new Date().toISOString());

      if (!pledge || Date.parse(pledge.expires_at) < Date.now()) return back("expired");

      /* Un intento que sale mal quema el pagaré: reintentar con los mismos
         parámetros no puede dar otro resultado, y dejarlo vivo alarga la
         ventana en la que alguien puede reutilizarlo. */
      const burn = async () => {
        await admin.from("steam_link_nonces").delete().eq("nonce", nonce);
      };

      const checked = checkReturn(url.searchParams, returnTo(nonce));
      if (!checked.ok) {
        await burn();
        return back(checked.reason === "cancelled" ? "cancelled" : "invalid");
      }

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
      if (!verify.ok || !isValid(await verify.text())) {
        await burn();
        return back("invalid");
      }

      const { error } = await admin
        .from("steam_link_nonces")
        .update({ steam_id: checked.steamId })
        .eq("nonce", nonce);
      if (error) {
        await burn();
        return back("error");
      }

      return back("confirm", `&n=${encodeURIComponent(nonce)}`);
    }

    /* ── El resto exige sesión ──────────────────────────────────────────── */
    const userId = await userOf(req);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const auth = req.headers.get("Authorization")!;

    /* ── GET /login — a dónde mandar a la persona ───────────────────────── */
    if (path === "/login") {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const { error } = await admin
        .from("steam_link_nonces")
        .insert({ nonce, user_id: userId });
      if (error) throw new Error(`nonce: ${error.message}`);

      return json({ url: authUrl(returnTo(nonce)) });
    }

    /* ── POST /confirm — la sesión reclama lo que Steam confirmó ────────── */
    //
    // El segundo paso del enlace, y el que impide el login CSRF: lo que decide
    // en qué perfil se escribe es el JWT de ESTA petición, no el `user_id` que
    // alguien metió en el pagaré. Si el pagaré es de otra persona —el caso de
    // "te paso un enlace de Steam y tu cuenta acaba en mi perfil"— aquí no
    // casa y no se escribe nada.
    if (path === "/confirm" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const nonce = String(body?.nonce ?? "");
      const { data: pledge } = await admin
        .from("steam_link_nonces")
        .select("*")
        .eq("nonce", nonce)
        .maybeSingle();

      if (!pledge || !pledge.steam_id || Date.parse(pledge.expires_at) < Date.now()) {
        return json({ status: "expired" });
      }
      if (pledge.user_id !== userId) {
        // Se quema igual: un pagaré que ha llegado al navegador equivocado ya
        // no vale para nada bueno.
        await admin.from("steam_link_nonces").delete().eq("nonce", nonce);
        return json({ status: "mismatch" });
      }

      const { error } = await admin
        .from("profiles")
        .update({ steam_id: pledge.steam_id, steam_linked_at: new Date().toISOString() })
        .eq("id", userId);
      await admin.from("steam_link_nonces").delete().eq("nonce", nonce);

      // El índice único: esa cuenta de Steam ya está enlazada a otro perfil de
      // Reel. Es un caso legítimo (dos cuentas de Reel, una de Steam) y hay que
      // decirlo, no dejarlo en un 500.
      if (error) return json({ status: error.code === "23505" ? "taken" : "error" });
      return json({ status: "linked" });
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
        .from("game_imports")
        .insert({ user_id: userId, provider: "steam" })
        .select()
        .single();
      if (runError) throw new Error(`game_imports: ${runError.message}`);

      const fail = async (reason: string) => {
        await admin
          .from("game_imports")
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
        const { error } = await admin.from("game_import_items").insert(
          part.map((i) => ({ ...i, import_id: run.id, user_id: userId })),
        );
        if (error) throw new Error(`game_import_items: ${error.message}`);
      }

      await admin
        .from("game_imports")
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
         casilla que hay que sincronizar. Eso vale igual para lo que 0078 añade
         —el estado y la nota de cada juego— que para `overwrite`, la casilla de
         la fila en conflicto: se deciden mirando la lista y se mandan al
         confirmar, todo de una vez.

         Nada de esto se cree tal cual llega: lo limpia `parsePick`. */
      const picks = new Map<string, Pick>();
      for (const raw of Array.isArray(body?.items) ? body.items : []) {
        const pick = parsePick(raw);
        if (pick) picks.set(pick.id, pick);
      }
      if (!importId || !picks.size) return json({ error: "nothing selected" }, 400);

      const { data: run } = await admin
        .from("game_imports")
        .select("*")
        .eq("id", importId)
        .eq("user_id", userId)
        // Desde 0082 la tabla la comparten dos proveedores: confirmar aquí un
        // borrador de Nintendo escribiría `minutes_source = 'steam'` en horas
        // que no son de Steam.
        .eq("provider", "steam")
        .maybeSingle();
      if (!run) return json({ error: "not found" }, 404);

      const chosen: Any[] = [];
      for (const part of chunk([...picks.keys()], ID_PAGE)) {
        const { data, error } = await admin
          .from("game_import_items")
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
          picks.get(item.id)?.overwrite ?? false,
        );

      /* Lo que la persona dijo de ESA fila. Un juego que llegó a la lista pero
         no venía en la petición no debería estar aquí, y si estuviera se trata
         como lo que 0076 hacía: tuyo y sin estado. */
      const pickFor = (item: Any): Pick =>
        picks.get(item.id) ??
        { id: item.id, overwrite: false, playState: null, finished: false, rating: null };

      const ready = chosen.filter((i) => i.title_id);
      const pending = chosen.filter((i) => !i.title_id);

      const applied = await writeEntries(
        admin,
        userId,
        ready.map((i) => ({
          titleId: i.title_id as string,
          minutes: minutesFor(i),
          playState: pickFor(i).playState,
        })),
        "steam",
      );
      /* La nota y el terminado van DESPUÉS de la biblioteca, y en ese orden: la
         fila de `library_entries` es lo que hace que el juego exista en tu
         biblioteca, y una nota o un final colgando de un juego que no sigues
         serían huérfanos que no aparecen en ninguna pantalla. */
      const rated = await writeRatings(
        admin,
        userId,
        ready
          .map((i) => ({ titleId: i.title_id as string, rating: pickFor(i).rating }))
          .filter((r): r is { titleId: string; rating: number } => r.rating !== null),
      );
      const finished = await writeFinished(
        admin,
        userId,
        ready
          .filter((i) => pickFor(i).finished)
          .map((i) => ({ titleId: i.title_id as string, at: finishedAt(i.last_played_at) })),
        "steam",
      );
      if (ready.length) {
        for (const part of chunk(ready.map((i) => i.id), ID_PAGE)) {
          await admin.from("game_import_items").update({ state: "applied" }).in("id", part);
        }
      }

      await admin
        .from("game_imports")
        .update({
          state: pending.length ? "applying" : "done",
          finished_at: pending.length ? null : new Date().toISOString(),
          summary: { ...run.summary, applied, rated, finished, pending: pending.length },
        })
        .eq("id", importId);

      /* Lo que el catálogo no conocía se resuelve DETRÁS de la respuesta. A 4
         req/s compartidas entre todos, esperar aquí sería tener a la persona
         mirando una rueda mientras la petición se acerca al tope de la
         plataforma; y con `job_runs` queda registro de cómo fue, que es lo que
         los crons ya hacen. */
      if (pending.length) {
        // Lo que el catálogo aún no conocía se escribe con SU MISMO pick: si no,
        // el estado y la nota que marcaste se perderían justo en los juegos que
        // tardan más en entrar, que es donde nadie volvería a mirar.
        inBackground(resolvePending(admin, userId, auth, importId, pending, minutesFor, pickFor));
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
  pickFor: (item: Any) => Pick,
) {
  const startedAt = new Date().toISOString();
  let resolved = 0;
  let rated = 0;
  let finished = 0;
  let ok = false;
  let note: string | null = null;

  /* Las filas vienen de la base, donde el appid vive como TEXTO desde 0082
     (`external_id`, compartida con Nintendo). Una sola conversión aquí en vez
     de un `Number()` suelto en cada uso, que es como se cuelan los NaN. */
  const appidOf = (i: Any) => Number(i.external_id);

  try {
    const { found: byAppid, failedChunks } = await resolveAppids(
      auth,
      pending.map(appidOf),
    );

    const found = pending.filter((i) => byAppid.has(appidOf(i)));
    const lost = pending.filter((i) => !byAppid.has(appidOf(i)));

    if (found.length) {
      /* El title_id descubierto se guarda en la fila del borrador antes de
         usarlo: si la escritura de abajo se cae, el siguiente intento no vuelve
         a preguntarle a IGDB por lo mismo.

         En un upsert por tandas y no fila a fila: trescientos juegos eran
         trescientos viajes a la base dentro de un waitUntil, que es donde el
         tiempo de pared sí se acaba. Van todas las columnas obligatorias
         porque un upsert que insertara —no debería, la fila existe— no puede
         quedarse a medias. */
      for (const part of chunk(found, PAGE)) {
        const { error } = await admin.from("game_import_items").upsert(
          part.map((i) => ({
            id: i.id,
            import_id: i.import_id,
            user_id: i.user_id,
            external_id: i.external_id,
            name: i.name,
            minutes: i.minutes,
            last_played_at: i.last_played_at,
            title_id: byAppid.get(appidOf(i)),
            state: "applied",
          })),
          { onConflict: "id" },
        );
        if (error) throw new Error(`items resolved: ${error.message}`);
      }
      resolved = await writeEntries(
        admin,
        userId,
        found.map((i) => ({
          titleId: byAppid.get(appidOf(i))!,
          minutes: minutesFor(i),
          playState: pickFor(i).playState,
        })),
        "steam",
      );
      rated = await writeRatings(
        admin,
        userId,
        found
          .map((i) => ({ titleId: byAppid.get(appidOf(i))!, rating: pickFor(i).rating }))
          .filter((r): r is { titleId: string; rating: number } => r.rating !== null),
      );
      finished = await writeFinished(
        admin,
        userId,
        found
          .filter((i) => pickFor(i).finished)
          .map((i) => ({ titleId: byAppid.get(appidOf(i))!, at: finishedAt(i.last_played_at) })),
        "steam",
      );
    }

    // Demos, herramientas y juegos retirados: IGDB no los tiene fichados por su
    // appid. Se marcan y se cuentan, porque enseñar "importados 40" habiendo
    // entrado 38 es mentir en la única pantalla que la persona va a mirar.
    if (lost.length) {
      for (const part of chunk(lost.map((i) => i.id), ID_PAGE)) {
        await admin.from("game_import_items").update({ state: "unresolved" }).in("id", part);
      }
      note = failedChunks
        ? `${lost.length} sin resolver (${failedChunks} lote(s) fallaron; vuelve a sincronizar)`
        : `${lost.length} sin equivalente en IGDB`;
    }
    ok = true;
  } catch (e) {
    note = String((e as Error)?.message ?? e);
    console.error("steam-sync resolve", importId, note);
  }

  const { data: current } = await admin
    .from("game_imports")
    .select("summary")
    .eq("id", importId)
    .maybeSingle();

  await admin
    .from("game_imports")
    .update({
      state: ok ? "done" : "error",
      error: ok ? null : "resolve",
      finished_at: new Date().toISOString(),
      summary: {
        ...(current?.summary ?? {}),
        resolved,
        rated: Number((current?.summary ?? {}).rated ?? 0) + rated,
        finished: Number((current?.summary ?? {}).finished ?? 0) + finished,
        pending: 0,
        note,
      },
    })
    .eq("id", importId);

  await admin.from("job_runs").insert({
    job: "steam-sync",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    summary: { import_id: importId, asked: pending.length, resolved, rated, finished, note },
  }).then(() => {}, () => {});
}
