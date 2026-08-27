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
// Esa misma fecha va también a `played_at` de la biblioteca (ver
// `writePlayedAt`): sin ella, importar fecha los trescientos juegos HOY, y "lo
// que estabas jugando" pasa a ordenar por el minuto en que le diste al botón.
//
// ── El puente Steam↔IGDB ya existe ───────────────────────────────────────
// `titles.steam_appid` lo llena `igdb-proxy` en cada ficha desde el
// `external_games` de IGDB. Así que casar lo que ya está en el catálogo es un
// índice, no una petición. Lo que NO está se resuelve por la ruta `/by-steam`
// de igdb-proxy, y solo para lo que la persona haya marcado: en segundo plano,
// por lotes, y con su fila en `job_runs` como los crons.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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

/* PostgREST corta en 1.000 filas sin avisar (config.toml → max_rows). Ninguna
   consulta de aquí pide más que esto de golpe: una biblioteca de Steam de mil
   y pico juegos existe, y una lectura truncada en silencio se leería como
   "esos juegos no los tienes". */
const PAGE = 500;

/* Y el otro tope, que no es de filas sino de CARACTERES: un filtro `in.(…)` de
   PostgREST viaja en la query string, y un uuid ocupa 37 bytes con su coma. 500
   uuids son 18 KB de URL, muy por encima de los 8 KB que aceptan la pasarela y
   Cloudflare — o sea un 414 que aquí se vería como "la importación falla si
   marcas muchos juegos", que es justo el caso que esta rama tiene que aguantar.
   Con enteros (los appid) no hace falta: ocupan seis. */
const ID_PAGE = 100;

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
      appid: g.appid,
      steam_name: g.name,
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

/** Lo que se escribe de un juego en la biblioteca. */
interface EntryWrite {
  titleId: string;
  minutes: number | null;
  /** Lo que la persona marcó, o null para no tocar `play_state`.
   *
   *  Null es NO TOCARLO y no "quitarlo", y la diferencia importa: un juego que
   *  ya tenías en "Jugando" y que confirmas sin marcarle nada no puede salir de
   *  la importación sin estado. Aquí no hay forma de borrarlo — para eso está
   *  la ficha, que es donde se puso. */
  playState: Pick["playState"];
}

/** Escribe en la biblioteca las filas que ya tienen `title_id`. */
async function writeEntries(
  admin: SupabaseClient,
  userId: string,
  rows: EntryWrite[],
): Promise<number> {
  /* Un upsert POR JUEGO DE COLUMNAS, y esto no es manía: la lista del
     `on conflict do update` de PostgREST sale de la UNIÓN de claves del lote.
     Si una fila lleva `minutes_played` y otra no, la que no lo lleva recibe un
     null — o sea, borrar las horas que esa persona escribió a mano, que es
     justo lo que esta rama existe para no hacer. Con `play_state` (0078) el
     lote se parte en cuatro en vez de en dos, pero el criterio es el mismo:
     agrupar por QUÉ columnas se escriben, nunca por sus valores.

     `play_state` no aparece en el grupo que no lo lleva, y por eso importar sin
     marcar nada no puede pisar el estado que ya tenías. */
  const groups = new Map<string, EntryWrite[]>();
  for (const r of rows) {
    const key = `${r.minutes !== null ? "m" : ""}${r.playState ? "s" : ""}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  let written = 0;
  for (const [key, part] of groups) {
    const { error } = await admin.from("library_entries").upsert(
      part.map((r) => ({
        user_id: userId,
        title_id: r.titleId,
        followed: true,
        owned: true,
        ...(r.minutes !== null ? { minutes_played: r.minutes, minutes_source: "steam" } : {}),
        ...(r.playState ? { play_state: r.playState } : {}),
      })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`library upsert (${key || "owned"}): ${error.message}`);
    written += part.length;
  }

  return written;
}

/** La fecha de tu última partida, escrita en la biblioteca.
 *
 *  Steam dice cuándo abriste cada juego por última vez —`rtime_last_played`, en
 *  la misma respuesta que las horas—, y es la fecha que `played_at` (0075)
 *  quiere decir: "cuándo tocaste esto". Sin esto la importación fecha los
 *  trescientos HOY, porque el disparador `game_progress_touch` escribe `now()`
 *  en cuanto cambian las horas o el estado. O sea que después de sincronizar,
 *  "vuelve a lo que estabas jugando" (domain/gameTonight) ordena por el minuto
 *  en que le diste al botón; y un juego que marcas ABANDONADO queda fechado el
 *  día que lo dijiste, no el día que lo dejaste. Es la misma regla que 0078 ya
 *  aplicó a lo terminado (ver `writeFinished`), que era la otra mitad.
 *
 *  Va en una escritura APARTE y detrás, y esa es toda la gracia: en el mismo
 *  upsert que las horas, el disparador la pisaría con `now()` —cambian los
 *  minutos, luego dispara—. Un update que solo toca `played_at` no cumple su
 *  WHEN (`minutes_played` o `play_state` distintos), así que no dispara y el
 *  valor se queda como se escribe. Por eso tampoco hace falta migración.
 *
 *  Solo las filas con fecha: un juego que Steam dice que nunca abriste no tiene
 *  una que ofrecer, y escribir null ahí borraría la que pusiera la ficha. */
async function writePlayedAt(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; at: string }[],
): Promise<number> {
  if (!rows.length) return 0;
  for (const part of chunk(rows, PAGE)) {
    const { error } = await admin.from("library_entries").upsert(
      part.map((r) => ({ user_id: userId, title_id: r.titleId, played_at: r.at })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`played_at upsert: ${error.message}`);
  }
  return rows.length;
}

/** Las notas que la persona puso en la pantalla de confirmar.
 *
 *  Un upsert como el de la ficha (`app/src/lib/ratings.ts`), con la misma clave
 *  única: puntuar dos veces el mismo juego es corregir la nota, no apilar dos.
 *  Se cuenta lo escrito porque el recibo lo enseña. */
async function writeRatings(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; rating: number }[],
): Promise<number> {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  for (const part of chunk(rows, PAGE)) {
    const { error } = await admin.from("ratings").upsert(
      part.map((r) => ({ user_id: userId, title_id: r.titleId, score: r.rating, updated_at: now })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`ratings upsert: ${error.message}`);
  }
  return rows.length;
}

/** Lo marcado como terminado, con la fecha de tu última partida.
 *
 *  Terminado no es un `play_state`: es el `watch_event` del episodio sintético
 *  (0071), que es lo que hace que un juego acabado entre en el historial, en el
 *  muro y en las notas sin que nada de eso sepa que existen los videojuegos.
 *
 *  Dos detalles que no son opcionales:
 *
 *    · `watched_at` sale de `last_played_at` (0078). Con `now()` por defecto,
 *      confirmar cuarenta juegos publicaría cuarenta finales esta tarde.
 *    · `ignoreDuplicates`, contra la clave única (user_id, episode_id): si ya
 *      lo tenías terminado, volver a importar NO puede mover la fecha del
 *      evento que ya estaba — esa la pusiste tú. */
async function writeFinished(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; at: string }[],
): Promise<number> {
  if (!rows.length) return 0;

  // title_id → episodio sintético. El de un juego es siempre el 1x01 (0071).
  const episodeOf = new Map<string, string>();
  for (const part of chunk(rows.map((r) => r.titleId), ID_PAGE)) {
    const { data, error } = await admin
      .from("episodes")
      .select("id, title_id")
      .eq("season_number", 1)
      .eq("episode_number", 1)
      .in("title_id", part);
    if (error) throw new Error(`episodes: ${error.message}`);
    for (const row of data ?? []) episodeOf.set(row.title_id, row.id);
  }

  const events = rows
    .filter((r) => episodeOf.has(r.titleId))
    .map((r) => ({
      user_id: userId,
      episode_id: episodeOf.get(r.titleId)!,
      watched_at: r.at,
      source: "steam",
    }));
  if (!events.length) return 0;

  /* El `select` no es decoración: con `ignoreDuplicates` PostgREST devuelve
     solo las filas que ha INSERTADO, así que es la única forma de que el recibo
     diga cuántos finales entraron de verdad. Contar los intentos diría "5
     terminados" cuando tres ya lo estaban desde antes — la misma mentira que la
     nota de los que IGDB no encuentra existe para no contar. */
  let written = 0;
  for (const part of chunk(events, PAGE)) {
    const { data, error } = await admin
      .from("watch_events")
      .upsert(part, { onConflict: "user_id,episode_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`watch_events: ${error.message}`);
    written += (data ?? []).length;
  }
  return written;
}

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
        .from("steam_imports")
        .select("*")
        .eq("id", importId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!run) return json({ error: "not found" }, 404);

      const chosen: Any[] = [];
      for (const part of chunk([...picks.keys()], ID_PAGE)) {
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
      );
      /* Y la fecha de la última partida encima de la que acaba de poner el
         disparador, que es hoy. Ver writePlayedAt. */
      await writePlayedAt(
        admin,
        userId,
        ready
          .filter((i) => i.last_played_at)
          .map((i) => ({ titleId: i.title_id as string, at: i.last_played_at as string })),
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
      );
      if (ready.length) {
        for (const part of chunk(ready.map((i) => i.id), ID_PAGE)) {
          await admin.from("steam_import_items").update({ state: "applied" }).in("id", part);
        }
      }

      await admin
        .from("steam_imports")
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

  try {
    const { found: byAppid, failedChunks } = await resolveAppids(
      auth,
      pending.map((i) => i.appid),
    );

    const found = pending.filter((i) => byAppid.has(i.appid));
    const lost = pending.filter((i) => !byAppid.has(i.appid));

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
        const { error } = await admin.from("steam_import_items").upsert(
          part.map((i) => ({
            id: i.id,
            import_id: i.import_id,
            user_id: i.user_id,
            appid: i.appid,
            steam_name: i.steam_name,
            minutes: i.minutes,
            last_played_at: i.last_played_at,
            title_id: byAppid.get(i.appid),
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
          titleId: byAppid.get(i.appid)!,
          minutes: minutesFor(i),
          playState: pickFor(i).playState,
        })),
      );
      await writePlayedAt(
        admin,
        userId,
        found
          .filter((i) => i.last_played_at)
          .map((i) => ({ titleId: byAppid.get(i.appid)!, at: i.last_played_at as string })),
      );
      rated = await writeRatings(
        admin,
        userId,
        found
          .map((i) => ({ titleId: byAppid.get(i.appid)!, rating: pickFor(i).rating }))
          .filter((r): r is { titleId: string; rating: number } => r.rating !== null),
      );
      finished = await writeFinished(
        admin,
        userId,
        found
          .filter((i) => pickFor(i).finished)
          .map((i) => ({ titleId: byAppid.get(i.appid)!, at: finishedAt(i.last_played_at) })),
      );
    }

    // Demos, herramientas y juegos retirados: IGDB no los tiene fichados por su
    // appid. Se marcan y se cuentan, porque enseñar "importados 40" habiendo
    // entrado 38 es mentir en la única pantalla que la persona va a mirar.
    if (lost.length) {
      for (const part of chunk(lost.map((i) => i.id), ID_PAGE)) {
        await admin.from("steam_import_items").update({ state: "unresolved" }).in("id", part);
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
