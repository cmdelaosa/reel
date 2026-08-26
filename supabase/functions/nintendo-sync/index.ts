// nintendo-sync — Deno edge function. Traer de Nintendo las horas jugadas (0082).
//
// Rutas (bajo /functions/v1/nintendo-sync):
//   POST /link     → { status }        guarda el código de amigo y lo resuelve
//   POST /unlink   → { ok }
//   POST /scan     → { import_id }     pide el registro y prepara el borrador
//   POST /apply    → { applied, pending }  confirma lo marcado
//   POST /refresh  → { updated }       actualiza las horas de lo ya importado
//
// ── Por qué esta función es más simple que steam-sync ────────────────────
// Porque no hay login por usuario. Steam necesitaba un ida y vuelta de OpenID
// —con su pagaré, su ruta sin sesión y su desplegado sin `verify_jwt`— porque
// la identidad la ponía la PERSONA. Aquí la identidad de quien pregunta es
// siempre la misma: la cuenta de Nintendo de Reel. Lo que la persona aporta es
// un código de amigo, que es público y que se escribe en un campo de texto.
//
// Así que esta función se despliega con la reja de JWT normal y no tiene ni una
// ruta anónima.
//
// ── Y por qué es más frágil ──────────────────────────────────────────────
// Toda la conversación con Nintendo vive en coral.ts, e incluye un tercero: el
// servicio que calcula el parámetro `f`. Está explicado allí y en docs/DEPLOY.md.
// Lo que importa aquí es que un fallo suyo NO puede parecer "no has jugado a
// nada": los errores de Coral llevan su número y se cuentan aparte.
//
// ── El emparejamiento es por NOMBRE, y eso decide el resto ───────────────
// Nintendo no da ningún identificador de juego. No hay puente como
// `titles.steam_appid`: hay títulos. Por eso
//
//   · el borrador guarda `external_id` (el nsuid de la tienda o el nombre
//     normalizado) solo para reconocer las mismas filas al reescanear, no para
//     casar con el catálogo;
//   · casar con el catálogo es comparar nombres, aquí y en la ruta /by-name de
//     igdb-proxy, con el mismo listón: igualdad exacta del nombre normalizado.
//     Lo que no lo pase se queda sin resolver y se dice. Un juego que no entra
//     lo arregla la persona; uno equivocado que sí entra no lo ve nadie.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chunk,
  ID_PAGE,
  isConflict,
  minutesToWrite,
  PAGE,
  parsePick,
  type Pick,
  writeEntries,
  writeRatings,
} from "../_shared/game-import.ts";
import {
  type CoralConfig,
  CoralError,
  type CoralSession,
  login,
  playLog,
  userByFriendCode,
} from "./coral.ts";
import { normalizeFriendCode, parsePlayLog, playedAtFor } from "./merge.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Cuántos nombres se le piden a igdb-proxy de una vez. Es su tope por petición
 *  (NAME_MAX allí); pasarse devuelve un 400 en vez de resolver menos. */
const RESOLVE_CHUNK = 30;

/** Cuántos NOMBRES caben en un filtro `in.(…)` de PostgREST.
 *
 *  Aparte de ID_PAGE y más bajo que él a propósito: aquel está dimensionado
 *  para uuids, que ocupan 37 bytes contados. Un título de juego puede pasar de
 *  sesenta caracteres y encima viaja urlencodeado, así que los mismos 100
 *  elementos que con uuids dan 4 KB aquí pueden acercarse a los 8 KB que
 *  aceptan la pasarela y Cloudflare — y lo que se ve entonces no es un error de
 *  nombres, es un 414. */
const NAME_PAGE = 40;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

/** Lanza trabajo sin que la respuesta lo espere. Idéntico al de steam-sync: sin
 *  waitUntil la plataforma mata la invocación con la promesa a medias. */
function inBackground(work: Promise<unknown>) {
  const runtime = (globalThis as Any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work.catch(() => {}));
  else work.catch(() => {});
}

/* ─────────────────────────── La sesión de Coral ─────────────────────────── */

/** El token de Coral, cacheado en el isolate.
 *
 *  Dura dos horas y se reutiliza mientras le quede más de un minuto. En la base
 *  no, por lo mismo que el token de Twitch en igdb-proxy: es un secreto más que
 *  rotar y se puede volver a pedir en una llamada.
 *
 *  El precio de cachear por isolate es que un isolate frío paga el login
 *  entero, y ese login pasa por un móvil Android de verdad arrancando la app de
 *  Nintendo: segundos, no milisegundos. Se acepta porque estas rutas se llaman
 *  una vez por importación y no una por tecla. */
let session: CoralSession | null = null;

function coralConfig(): CoralConfig {
  const sessionToken = Deno.env.get("NINTENDO_SESSION_TOKEN");
  if (!sessionToken) throw new Error("NINTENDO_SESSION_TOKEN not configured");
  return {
    sessionToken,
    fApiUrl: (Deno.env.get("NINTENDO_F_API_URL") ?? "https://nxapi-znca-api.fancy.org.uk/api/znca")
      .replace(/\/+$/, ""),
    fClientId: Deno.env.get("NINTENDO_F_CLIENT_ID") ?? undefined,
    fClientSecret: Deno.env.get("NINTENDO_F_CLIENT_SECRET") ?? undefined,
    fTokenUrl: Deno.env.get("NINTENDO_F_TOKEN_URL") ?? undefined,
    /* El servicio de f lo exige en su README: nombre, versión y forma de dar
       con el proyecto. No es cortesía — es cómo su dueño sabe a quién avisar
       cuando algo se rompe o a quién cortar cuando algo abusa. */
    userAgent: Deno.env.get("NINTENDO_USER_AGENT") ??
      "reel/1.0 (+https://github.com/cmdelaosa/reel)",
  };
}

async function coral(): Promise<CoralSession> {
  if (session && session.expiresAt > Date.now() + 60_000) return session;
  session = await login(coralConfig());
  return session;
}

/* ─────────────────────────── Sesión de Reel ─────────────────────────────── */

/** El usuario de la petición, o null. Un viaje a la base por petición, igual
 *  que en steam-sync: estas rutas se llaman una vez por importación. */
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

/* ─────────────────────────── El catálogo, por nombre ────────────────────── */

/** Nombre → fila de `titles`, para lo que el catálogo ya conoce.
 *
 *  Se compara el nombre TAL CUAL, que es lo que un índice puede resolver. La
 *  comparación indulgente —sin acentos ni signos— la hace /by-name en
 *  igdb-proxy sobre lo que aquí no case: aquí lo que se busca es lo barato.
 *
 *  Puede devolver más de una fila con el mismo nombre (dos juegos homónimos en
 *  IGDB). Gana la primera y da igual cuál sea: si el catálogo tiene dos juegos
 *  llamados exactamente igual, ninguna heurística de aquí lo va a arreglar, y
 *  la persona lo ve en la pantalla de confirmar con su carátula. */
async function titlesByName(
  admin: SupabaseClient,
  names: string[],
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const part of chunk(names, NAME_PAGE)) {
    const { data, error } = await admin
      .from("titles")
      .select("id, name")
      .eq("kind", "game")
      .in("name", part);
    if (error) throw new Error(`titles by name: ${error.message}`);
    for (const row of data ?? []) if (!byName.has(row.name)) byName.set(row.name, row.id);
  }
  return byName;
}

/** Lo que la biblioteca de esa persona dice hoy de esos juegos.
 *
 *  `followed` viaja también, y no es decoración: quitar un juego de la
 *  biblioteca no borra su fila, la deja con `followed = false` (así se
 *  conservan tus horas y tu nota si lo vuelves a añadir). Quien escriba tiene
 *  que mirarlo — ver /refresh. */
interface Entry {
  minutes: number | null;
  source: string | null;
  followed: boolean;
}

async function entriesOf(
  admin: SupabaseClient,
  userId: string,
  titleIds: string[],
): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  for (const part of chunk(titleIds, ID_PAGE)) {
    const { data, error } = await admin
      .from("library_entries")
      .select("title_id, minutes_played, minutes_source, followed")
      .eq("user_id", userId)
      .in("title_id", part);
    if (error) throw new Error(`library_entries: ${error.message}`);
    for (const row of data ?? []) {
      entries.set(row.title_id, {
        minutes: row.minutes_played,
        source: row.minutes_source,
        followed: Boolean(row.followed),
      });
    }
  }
  return entries;
}

/** Le pregunta a igdb-proxy por los nombres que el catálogo no conocía.
 *
 *  Con el JWT de quien importa y a su ruta /by-name, por lo mismo que
 *  steam-sync hace con /by-steam: allí están el token de Twitch y el
 *  estrangulador de las 4 req/s, que son del proyecto y no de esta persona. */
async function resolveNames(
  auth: string,
  names: string[],
): Promise<{ found: Map<string, string>; failedChunks: number }> {
  const found = new Map<string, string>();
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/igdb-proxy/by-name`;
  let failedChunks = 0;

  for (const part of chunk(names, RESOLVE_CHUNK)) {
    // Cada tanda cae por su cuenta: que la segunda falle no puede descartar lo
    // que la primera ya resolvió.
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": auth,
          "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ names: part }),
        // Generoso: dentro hay hasta treinta peticiones a IGDB espaciadas a
        // 250 ms, más los upserts.
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`igdb-proxy by-name ${res.status}`);
      const body = await res.json();
      for (const [name, title] of Object.entries(body?.matches ?? {})) {
        const id = (title as Any)?.id;
        if (id) found.set(name, id as string);
      }
    } catch (e) {
      failedChunks++;
      console.error("nintendo-sync resolve chunk", String(e));
    }
  }
  return { found, failedChunks };
}

/* ─────────────────────────── El registro, ya cruzado ────────────────────── */

interface Scanned {
  external_id: string;
  name: string;
  minutes: number;
  image_uri: string | null;
  title_id: string | null;
  in_library: boolean;
  manual_minutes: number | null;
}

/** Pide el registro de juego y lo cruza con lo que ya hay. Ni una petición a
 *  IGDB: el nombre, las horas y la carátula los da Nintendo.
 *
 *  La sesión llega de fuera y no se pide aquí: entrar en Coral y leer el
 *  registro fallan por motivos DISTINTOS —el nuestro y el de la otra persona— y
 *  quien llama tiene que poder contarlos aparte. Ver /scan. */
async function scanned(
  admin: SupabaseClient,
  userId: string,
  nsaId: string,
  session: CoralSession,
): Promise<Scanned[]> {
  const games = parsePlayLog(await playLog(session, nsaId));
  if (!games.length) return [];

  const byName = await titlesByName(admin, games.map((g) => g.name));
  const entries = await entriesOf(admin, userId, [...byName.values()]);

  return games.map((g) => {
    const titleId = byName.get(g.name) ?? null;
    const current = titleId ? entries.get(titleId) ?? null : null;
    return {
      external_id: g.externalId,
      name: g.name,
      minutes: g.minutes,
      image_uri: g.imageUri,
      title_id: titleId,
      in_library: Boolean(current),
      // Solo cuando hay algo que perder: es lo que la pantalla enseña como
      // "tú: 40 h · Nintendo: 12 h" y lo que convierte el conflicto en una
      // casilla en vez de en una cifra que desaparece.
      manual_minutes: current && isConflict(current, g.minutes) ? current.minutes ?? 0 : null,
    };
  });
}

/* ─────────────────────────── Rutas ──────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "not found" }, 404);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/nintendo-sync/, "").replace(/\/+$/, "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = await userOf(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const auth = req.headers.get("Authorization")!;

  try {
    /* ── POST /link — el código de amigo ────────────────────────────────── */
    //
    // Se resuelve ANTES de guardarlo, y por eso esta ruta habla con Nintendo.
    // Guardar un código sin comprobarlo dejaría el error para el primer
    // escaneo, o sea a tres pantallas de donde se escribió; y el NSA ID que
    // devuelve es justo lo que evita gastar esta llamada —que Nintendo
    // limita— en cada sincronización.
    if (path === "/link") {
      const body = await req.json().catch(() => null);
      const code = normalizeFriendCode(body?.friend_code);
      if (!code) return json({ status: "invalid" });

      let nsaId: string;
      try {
        const user = await userByFriendCode(await coral(), code);
        nsaId = user.nsaId;
      } catch (e) {
        // Un código con formato bueno y sin dueño es un caso corriente —un
        // dígito mal— y no una avería. Se dice por su nombre.
        if (e instanceof CoralError) {
          console.error("nintendo-sync link", e.message);
          return json({ status: "not_found" });
        }
        throw e;
      }

      const { error } = await admin
        .from("profiles")
        .update({
          nintendo_friend_code: code,
          nintendo_nsa_id: nsaId,
          nintendo_linked_at: new Date().toISOString(),
        })
        .eq("id", userId);

      // El índice único de 0082: esa cuenta de Nintendo ya está en otro perfil
      // de Reel. Es un caso legítimo (dos cuentas de Reel, una Switch) y hay
      // que decirlo, no dejarlo en un 500.
      if (error) return json({ status: error.code === "23505" ? "taken" : "error" });
      return json({ status: "linked", friend_code: code });
    }

    /* ── POST /unlink ──────────────────────────────────────────────────── */
    if (path === "/unlink") {
      const { error } = await admin
        .from("profiles")
        .update({ nintendo_friend_code: null, nintendo_nsa_id: null, nintendo_linked_at: null })
        .eq("id", userId);
      if (error) throw new Error(`unlink: ${error.message}`);
      // Lo ya importado se queda: son TUS horas y tu biblioteca. Desenlazar es
      // dejar de poder sincronizar, no deshacer lo sincronizado.
      return json({ ok: true });
    }

    /* ── POST /scan — pedir el registro y preparar el borrador ──────────── */
    if (path === "/scan") {
      const { data: profile } = await admin
        .from("profiles")
        .select("nintendo_nsa_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.nintendo_nsa_id) return json({ error: "not_linked" }, 400);

      const { data: run, error: runError } = await admin
        .from("game_imports")
        .insert({ user_id: userId, provider: "nintendo" })
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

      /* Entrar en Coral va PRIMERO y en su propio try, y esto es la diferencia
         entre culpar a quien toca y culpar a quien no. Un login que falla es
         cosa nuestra —el session_token de la cuenta bot caducado, el servicio
         de `f` caído— y también sale con un `status` de Nintendo, o sea también
         es un CoralError. Metido en el mismo try que la lectura del registro,
         una avería de Reel se le enseñaría a la persona como "ve a tu consola y
         cambia la privacidad": mandarla a tocar ajustes por algo que ella no ha
         roto y que no va a arreglar. */
      let session: CoralSession;
      try {
        session = await coral();
      } catch (e) {
        console.error("nintendo-sync login", String(e));
        return await fail("upstream");
      }

      let items: Scanned[];
      try {
        items = await scanned(admin, userId, profile.nintendo_nsa_id, session);
      } catch (e) {
        console.error("nintendo-sync scan", String(e));
        /* Aquí sí: el registro cerrado significa "ve a la consola y pon la
           privacidad del registro en Todos". Nintendo lo dice con un `status`
           suyo dentro de un 200, y con la sesión ya en la mano es lo único que
           puede fallar en esta llamada por decisión de la otra persona. */
        return await fail(e instanceof CoralError ? "private" : "upstream");
      }

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
    if (path === "/apply") {
      const body = await req.json().catch(() => null);
      const importId = String(body?.import_id ?? "");
      /* Lo marcado viaja en la petición y no está guardado: la pantalla se
         rellena una vez y se confirma una vez. Nada de esto se cree tal cual
         llega — lo limpia `parsePick`.

         `finished` se parsea y NO se usa: Nintendo no da la última partida con
         la que fechar el evento (ver 0082), así que esa casilla no existe en
         esta pantalla. Terminar un juego se marca desde la ficha. */
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
        .eq("provider", "nintendo")
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

      const ready = chosen.filter((i) => i.title_id);
      const pending = chosen.filter((i) => !i.title_id);

      /* Lo que la biblioteca dice AHORA, no lo que decía al escanear. Sirve
         para dos cosas a la vez: decidir los minutos (una cifra manual no se
         pisa sola) y aprender la última partida — que solo tiene sentido si la
         cifra anterior también venía de Nintendo. Comparar contra unas horas
         escritas a mano diría "ha jugado" cada vez que alguien las corrige. */
      const current = await entriesOf(admin, userId, ready.map((i) => i.title_id as string));

      const pickFor = (item: Any): Pick =>
        picks.get(item.id) ??
        { id: item.id, overwrite: false, playState: null, finished: false, rating: null };

      const applied = await writeEntries(
        admin,
        userId,
        ready.map((i) => {
          const before = current.get(i.title_id as string) ?? null;
          return {
            titleId: i.title_id as string,
            minutes: minutesToWrite(before, i.minutes, pickFor(i).overwrite),
            playState: pickFor(i).playState,
            playedAt: before?.source === "nintendo"
              ? playedAtFor(before.minutes, i.minutes)
              : null,
          };
        }),
        "nintendo",
      );
      /* La nota va DESPUÉS de la biblioteca: la fila de `library_entries` es lo
         que hace que el juego exista en tu biblioteca, y una nota colgando de
         un juego que no sigues es una huérfana que no aparece en ningún sitio. */
      const rated = await writeRatings(
        admin,
        userId,
        ready
          .map((i) => ({ titleId: i.title_id as string, rating: pickFor(i).rating }))
          .filter((r): r is { titleId: string; rating: number } => r.rating !== null),
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
          summary: { ...run.summary, applied, rated, pending: pending.length },
        })
        .eq("id", importId);

      // Lo que el catálogo no conocía se resuelve DETRÁS de la respuesta, con
      // su fila en `job_runs`: a 4 req/s compartidas, esperar aquí sería tener
      // a la persona mirando una rueda mientras la petición se acerca al tope.
      if (pending.length) {
        inBackground(resolvePending(admin, userId, auth, importId, pending, pickFor));
      }

      return json({ applied, pending: pending.length });
    }

    /* ── POST /refresh — solo las horas, sin pantalla ───────────────────── */
    //
    // Es la otra mitad de esta rama, y no es un /scan más pequeño: no crea
    // borrador, no pregunta nada y no mete juegos nuevos. Actualiza lo que YA
    // está en tu biblioteca, que es lo que se quiere cuando lo único que ha
    // cambiado desde ayer son veinte minutos de Mario Kart.
    //
    // Lo que no toca, y es deliberado:
    //   · las filas cuyas horas escribiste tú (`minutes_source = 'manual'`),
    //   · nada que no siguieras ya. Un juego nuevo entra por /scan, con su
    //     pantalla: aparecer solo en la biblioteca es lo que convierte una
    //     biblioteca en un catálogo.
    if (path === "/refresh") {
      const { data: profile } = await admin
        .from("profiles")
        .select("nintendo_nsa_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.nintendo_nsa_id) return json({ error: "not_linked" }, 400);

      // Login y lectura por separado, por lo mismo que en /scan: los dos fallan
      // con un CoralError y solo uno es culpa de quien mira la pantalla.
      let session: CoralSession;
      try {
        session = await coral();
      } catch (e) {
        console.error("nintendo-sync login", String(e));
        return json({ error: "upstream" }, 502);
      }

      let games;
      try {
        games = parsePlayLog(await playLog(session, profile.nintendo_nsa_id));
      } catch (e) {
        console.error("nintendo-sync refresh", String(e));
        return json({ error: e instanceof CoralError ? "private" : "upstream" }, 502);
      }
      if (!games.length) return json({ updated: 0, seen: 0 });

      const byName = await titlesByName(admin, games.map((g) => g.name));
      const entries = await entriesOf(admin, userId, [...byName.values()]);

      const rows = games
        .map((g) => ({ g, titleId: byName.get(g.name) }))
        .filter((x): x is { g: typeof games[number]; titleId: string } => Boolean(x.titleId))
        .map(({ g, titleId }) => ({ g, titleId, before: entries.get(titleId) }))
        /* Solo lo que ya sigues y cuyas horas no escribiste tú.
           `followed` es la mitad que no se ve: quitar un juego de la biblioteca
           deja su fila con `followed = false`, y `writeEntries` escribe siempre
           `followed = true`. Sin este filtro, actualizar las horas RESUCITARÍA
           los juegos que alguien quitó a propósito — y encima en silencio, un
           juego cada vez, cada vez que le diera al botón. */
        .filter((x) => x.before && x.before.followed && x.before.source !== "manual")
        // Y solo lo que ha cambiado: un upsert que escribe lo mismo es una fila
        // tocada sin motivo, y `played_at` no se aprende de una cifra igual.
        .filter((x) => (x.before!.minutes ?? 0) !== x.g.minutes);

      const updated = await writeEntries(
        admin,
        userId,
        rows.map(({ g, titleId, before }) => ({
          titleId,
          minutes: g.minutes,
          playState: null,
          playedAt: before!.source === "nintendo" ? playedAtFor(before!.minutes, g.minutes) : null,
        })),
        "nintendo",
      );

      return json({ updated, seen: games.length });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("nintendo-sync", path, String(e));
    return json({ error: "upstream error" }, 502);
  }
});

/** El trabajo de fondo: resolver contra IGDB los nombres que el catálogo no
 *  tenía y escribirlos. Con su fila en `job_runs` pase lo que pase — un trabajo
 *  sin registro es un trabajo que puede fallar todos los días sin que nadie se
 *  entere (0029). */
async function resolvePending(
  admin: SupabaseClient,
  userId: string,
  auth: string,
  importId: string,
  pending: Any[],
  pickFor: (item: Any) => Pick,
) {
  const startedAt = new Date().toISOString();
  let resolved = 0;
  let rated = 0;
  let ok = false;
  let note: string | null = null;

  try {
    const { found: byName, failedChunks } = await resolveNames(auth, pending.map((i) => i.name));

    const found = pending.filter((i) => byName.has(i.name));
    const lost = pending.filter((i) => !byName.has(i.name));

    if (found.length) {
      /* El title_id descubierto se guarda en la fila del borrador antes de
         usarlo: si la escritura de abajo se cae, el siguiente intento no vuelve
         a preguntarle a IGDB por lo mismo. */
      for (const part of chunk(found, PAGE)) {
        const { error } = await admin.from("game_import_items").upsert(
          part.map((i) => ({
            id: i.id,
            import_id: i.import_id,
            user_id: i.user_id,
            external_id: i.external_id,
            name: i.name,
            minutes: i.minutes,
            image_uri: i.image_uri,
            title_id: byName.get(i.name),
            state: "applied",
          })),
          { onConflict: "id" },
        );
        if (error) throw new Error(`items resolved: ${error.message}`);
      }

      /* Estos juegos acaban de entrar en el catálogo, así que nadie tenía una
         fila de biblioteca para ellos: no hay cifra anterior con la que
         comparar y `played_at` se queda como está. Las horas se escriben tal
         cual las da Nintendo. */
      resolved = await writeEntries(
        admin,
        userId,
        found.map((i) => ({
          titleId: byName.get(i.name)!,
          minutes: i.minutes,
          playState: pickFor(i).playState,
          playedAt: null,
        })),
        "nintendo",
      );
      rated = await writeRatings(
        admin,
        userId,
        found
          .map((i) => ({ titleId: byName.get(i.name)!, rating: pickFor(i).rating }))
          .filter((r): r is { titleId: string; rating: number } => r.rating !== null),
      );
    }

    /* Las apps de Nintendo Switch Online, las demos y lo que IGDB escribe de
       otra manera. Se marcan y se cuentan, porque enseñar "importados 20"
       habiendo entrado 13 es mentir en la única pantalla que se va a mirar. */
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
    console.error("nintendo-sync resolve", importId, note);
  }

  const { data: currentRun } = await admin
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
        ...(currentRun?.summary ?? {}),
        resolved,
        rated: Number((currentRun?.summary ?? {}).rated ?? 0) + rated,
        pending: 0,
        note,
      },
    })
    .eq("id", importId);

  await admin.from("job_runs").insert({
    job: "nintendo-sync",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    summary: { import_id: importId, asked: pending.length, resolved, rated, note },
  }).then(() => {}, () => {});
}
