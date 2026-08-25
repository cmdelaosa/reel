/**
 * Export de InfiniteBacklog → biblioteca de Reel. CLI de una sola vez; las
 * reglas viven en ./lib.ts con sus pruebas.
 *
 * LANZAR:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_… \
 *   TARGET_USER_ID=<profiles.id> \
 *   npx tsx index.ts <directorio-del-export> [--dry-run]
 *
 * El directorio es donde estén los tres CSV (`*GameCollection*.csv`,
 * `*Lists*.csv`, `*Wishlist*.csv`); se buscan por nombre, no por posición.
 *
 * ── Qué hace, en orden ───────────────────────────────────────────────────
 *   1. Lee los tres CSV y arma el plan (lib.ts).
 *   2. Resuelve cada id de IGDB a una fila de `titles`. Lo que ya está en el
 *      catálogo no se le pregunta a IGDB; lo que falta se pide a igdb-proxy por
 *      su ruta `/game/:id`, que es la MISMA que usa la ficha — así el juego
 *      entra con carátula, plataformas, fechas por plataforma y tiempos de
 *      HowLongToBeat, y no como una fila a medias.
 *   3. Lee lo que la cuenta ya tiene y decide fila a fila qué se escribe
 *      (decideEntry). Nada se pisa.
 *   4. Escribe: biblioteca, `played_at`, terminados y notas.
 *   5. Deja un informe JSON al lado del export.
 *
 * ── Por qué la clave de servicio y no una sesión ─────────────────────────
 * Tres columnas de esta importación son de solo lectura para el cliente y
 * tienen que serlo: `added_at`, `watch_events.watched_at` y `ratings.created_at`
 * las pone la base para que nadie pueda antedatar su actividad en el muro. Aquí
 * hay que escribirlas —el export las trae de verdad, de 2024— y eso solo lo
 * puede hacer algo que se salte la RLS. Es lo mismo que hace scripts/tvtime-import.
 *
 * ── Con `--dry-run` ──────────────────────────────────────────────────────
 * No se escribe NADA de la cuenta: ni biblioteca, ni terminados, ni notas. Lo
 * que sí puede escribirse es el CATÁLOGO (`titles`), porque resolver un juego
 * que Reel no conoce es pedirle la ficha a igdb-proxy y esa ruta cachea, igual
 * que abrir la ficha en la app. Es compartido y es el mismo dato que tendría
 * cualquiera que buscara ese juego, así que no hay nada que deshacer.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlan, decideEntry, type CurrentEntry } from "./lib.ts";

/** `watch_events.source` de lo que entre por aquí. La columna es texto libre
 *  (0003) y nadie la pinta, pero es lo único que separa esta importación de lo
 *  que marcaste a mano: sin ella, deshacerla sería imposible sin adivinar. */
const SOURCE = "infinitebacklog";

/** Un filtro `in.(…)` de PostgREST viaja en la query string, y un uuid ocupa 37
 *  bytes con su coma. Es el tope de steam-sync (ID_PAGE) y por lo mismo: 500
 *  uuids son 18 KB de URL contra los 8 KB que aceptan la pasarela y Cloudflare,
 *  o sea un 414 que se lee como "la importación falla si tienes muchos juegos". */
const ID_PAGE = 100;

/** Cuántas fichas se le piden a igdb-proxy a la vez. IGDB da 4 req/s AL
 *  PROYECTO entero y la ficha cuesta dos peticiones, así que de dos en dos ya
 *  se está pidiendo todo lo que hay — y en ese presupuesto entra también quien
 *  esté usando la app en ese momento. */
const RESOLVE_CONCURRENCY = 2;

interface Env {
  url: string;
  key: string;
  userId: string;
}

function readEnv(): Env {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Falta la variable de entorno ${k}`);
    return v;
  };
  return {
    url: need("SUPABASE_URL").replace(/\/+$/, ""),
    key: need("SUPABASE_SERVICE_ROLE_KEY"),
    userId: need("TARGET_USER_ID"),
  };
}

/* ─────────────────────────── PostgREST ─────────────────────────────────── */

// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function headers(env: Env, prefer?: string): Record<string, string> {
  const h: Record<string, string> = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "content-type": "application/json",
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

/** Una petición con reintentos. Lo que se reintenta son los 429 y los 5xx: un
 *  400 es un cuerpo mal formado y repetirlo veinte veces solo tarda más en
 *  contarlo. El mensaje de error incluye el cuerpo de la respuesta, que es donde
 *  PostgREST dice cuál es la comprobación que ha fallado. */
async function req(url: string, init: RequestInit, intentos = 4): Promise<Response> {
  let last = "";
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    last = `${res.status} ${body.slice(0, 400)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw new Error(`${init.method ?? "GET"} ${url.split("?")[0]} → ${last}`);
}

async function get(env: Env, path: string): Promise<Any[]> {
  const res = await req(`${env.url}/rest/v1/${path}`, { headers: headers(env) });
  return (await res.json()) as Any[];
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Una lectura por trozos de ids. Además del tope de la URL está el de las
 *  FILAS: PostgREST corta en 1.000 sin avisar, y una lectura truncada aquí se
 *  leería como "esos juegos no los tienes" — o sea, escribiría encima. */
async function getByIds(env: Env, path: string, campo: string, ids: string[]): Promise<Any[]> {
  const out: Any[] = [];
  for (const trozo of chunk(ids, ID_PAGE)) {
    out.push(...await get(env, `${path}${path.includes("?") ? "&" : "?"}${campo}=in.(${trozo.join(",")})`));
  }
  return out;
}

/* ───────────────────── Del id de IGDB a la fila de titles ──────────────── */

interface Resolved {
  titleId: string;
  episodeId: string | null;
}

/** Lo que ya está en el catálogo, sin gastar una petición a IGDB.
 *
 *  `last_refreshed_at` no null es lo que distingue una ficha de verdad de una
 *  fila que solo ha pasado por el buscador (lo escribe `gameRow` y no
 *  `gameSearchRow`, ver igdb-proxy). Una fila parcial se vuelve a pedir: entrar
 *  en la biblioteca sin fecha de salida ni carátula se ve como un juego roto. */
async function cachedTitles(env: Env, igdbIds: number[]): Promise<Map<number, Resolved>> {
  const found = new Map<number, Resolved>();
  for (const trozo of chunk(igdbIds, ID_PAGE)) {
    const rows = await get(
      env,
      `titles?kind=eq.game&select=id,tmdb_id,last_refreshed_at,episodes(id,season_number,episode_number)` +
        `&tmdb_id=in.(${trozo.join(",")})`,
    );
    for (const r of rows) {
      if (!r.last_refreshed_at) continue;
      const ep = (r.episodes ?? []).find((e: Any) => e.season_number === 1 && e.episode_number === 1);
      found.set(r.tmdb_id, { titleId: r.id, episodeId: ep?.id ?? null });
    }
  }
  return found;
}

/** La ficha por la misma ruta que usa la app. Devuelve null si IGDB no conoce
 *  ese id — pasa con ediciones retiradas y con filas que el export arrastra de
 *  una versión vieja del catálogo. */
async function resolveOne(env: Env, igdbId: number): Promise<Resolved | null> {
  const res = await fetch(`${env.url}/functions/v1/igdb-proxy/game/${igdbId}`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`igdb-proxy /game/${igdbId} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as Any;
  if (!body?.title?.id) return null;
  return { titleId: body.title.id, episodeId: body.episode_id ?? null };
}

/* ─────────────────────────────── main ──────────────────────────────────── */

function findCsv(dir: string, marca: string): string {
  const nombre = readdirSync(dir).find(
    (f) => f.toLowerCase().includes(marca.toLowerCase()) && f.toLowerCase().endsWith(".csv"),
  );
  // Vacío y no una excepción: el export de deseados puede no existir, y esa es
  // la diferencia entre "no lo has exportado" y "no tienes nada apuntado", que
  // para lo que hace este guión es la misma.
  return nombre ? readFileSync(join(dir, nombre), "utf8") : "";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("uso: tsx index.ts <directorio-del-export> [--dry-run]");
  const env = readEnv();
  /* Una sola marca para toda la ejecución, y no un `new Date()` por fila: lo
     que no trae fecha en el export se añade "ahora", y que ese ahora sea el
     mismo para las 115 filas es lo que deja que 0077 las pliegue en una sola
     frase del muro en vez de en 115. */
  const ahora = new Date().toISOString();

  const { games, skipped } = buildPlan(
    findCsv(dir, "GameCollection"),
    findCsv(dir, "Lists"),
    findCsv(dir, "Wishlist"),
  );
  const deColeccion = games.filter((g) => g.from === "collection").length;
  console.log(
    `${dir}${dryRun ? "  (dry run — no se escribe nada de la cuenta)" : ""}\n` +
      `  ${games.length} juegos: ${deColeccion} de la colección, ${games.length - deColeccion} solo en listas\n` +
      `  ${games.filter((g) => g.finished).length} terminados · ` +
      `${games.filter((g) => g.rating !== null).length} con nota · ` +
      `${games.filter((g) => g.minutes > 0).length} con horas`,
  );
  for (const s of skipped) console.log(`  ! ${s}`);

  /* 1. Resolver ------------------------------------------------------------ */
  const resolved = await cachedTitles(env, games.map((g) => g.igdbId));
  const faltan = games.filter((g) => !resolved.has(g.igdbId));
  console.log(`\nCatálogo: ${resolved.size} ya estaban, ${faltan.length} hay que pedírselas a IGDB.`);

  const noEncontrados: string[] = [];
  const errores: string[] = [];
  let hechos = 0;
  const cola = [...faltan];
  await Promise.all(
    Array.from({ length: RESOLVE_CONCURRENCY }, async () => {
      for (let g = cola.shift(); g; g = cola.shift()) {
        try {
          const r = await resolveOne(env, g.igdbId);
          if (r) resolved.set(g.igdbId, r);
          else noEncontrados.push(`${g.name} (IGDB ${g.igdbId})`);
        } catch (e) {
          errores.push(`${g.name} (IGDB ${g.igdbId}): ${(e as Error).message}`);
        }
        if (++hechos % 25 === 0) console.log(`  ${hechos}/${faltan.length}`);
      }
    }),
  );

  const listos = games.filter((g) => resolved.has(g.igdbId));
  const titleIds = listos.map((g) => resolved.get(g.igdbId)!.titleId);

  /* 2. Lo que la cuenta ya tiene ------------------------------------------- */
  const entradas = new Map<string, CurrentEntry>();
  for (const r of await getByIds(
    env,
    `library_entries?user_id=eq.${env.userId}&select=title_id,play_state,minutes_played,minutes_source,owned,added_at`,
    "title_id",
    titleIds,
  )) entradas.set(r.title_id, r);

  const yaPuntuados = new Set<string>(
    (await getByIds(env, `ratings?user_id=eq.${env.userId}&select=title_id`, "title_id", titleIds))
      .map((r: Any) => r.title_id),
  );

  const episodios = listos
    .filter((g) => g.finished)
    .map((g) => resolved.get(g.igdbId)!.episodeId)
    .filter((e): e is string => Boolean(e));
  const yaTerminados = new Set<string>(
    (await getByIds(env, `watch_events?user_id=eq.${env.userId}&select=episode_id`, "episode_id", episodios))
      .map((r: Any) => r.episode_id),
  );

  /* 3. Decidir ------------------------------------------------------------- */
  const nuevas: Any[] = [];
  const parches: Array<{ titleId: string; patch: Record<string, unknown> }> = [];
  const conflictos: string[] = [];
  const playedAt = new Map<string, string[]>();   // fecha → title_ids
  const terminados: Any[] = [];
  const notas: Any[] = [];
  let notasQueYaEstaban = 0;
  let sinEpisodio = 0;

  for (const g of listos) {
    const { titleId, episodeId } = resolved.get(g.igdbId)!;
    const actual = entradas.get(titleId) ?? null;
    const { patch, conflicts } = decideEntry(g, actual);
    conflictos.push(...conflicts);

    if (!actual) {
      nuevas.push({
        user_id: env.userId,
        title_id: titleId,
        followed: true,
        owned: patch.owned ?? false,
        play_state: patch.play_state ?? null,
        minutes_played: patch.minutes_played ?? 0,
        minutes_source: patch.minutes_source ?? null,
        // Sin fecha en el export —los CSV de listas no traen `Date added`— va
        // la de ahora, que es literalmente lo que pondría el default de la
        // columna. Y va EXPLÍCITA, no omitida: PostgREST rechaza un POST cuyas
        // filas no tengan todas las mismas claves ("All object keys must
        // match"), así que omitirla en 115 de las 349 tira el lote entero.
        added_at: patch.added_at ?? ahora,
      });
    } else if (Object.keys(patch).length > 1) {
      parches.push({ titleId, patch });
    }

    // played_at va DESPUÉS y aparte: los dos disparadores de 0075 son BEFORE y
    // lo machacan con now() en cuanto la fila nace o cambia con progreso. Un
    // update que solo toque esta columna no los despierta (su WHEN mira
    // minutes_played y play_state), así que la segunda pasada sí se queda.
    //
    // Se hace SIEMPRE que el export traiga fecha, y no solo cuando esta pasada
    // escriba algo. La diferencia se vio al reintentar una ejecución que había
    // dejado 200 filas a medias: en el segundo intento esas filas ya no cambian
    // nada, así que con la condición atada al patch se habrían quedado con el
    // now() que les puso el disparador la primera vez. Es idempotente, que es
    // justo lo que un importador que se puede reintentar necesita.
    if (g.playedAt) {
      const lista = playedAt.get(g.playedAt) ?? [];
      lista.push(titleId);
      playedAt.set(g.playedAt, lista);
    }

    if (g.finished) {
      if (!episodeId) sinEpisodio++;
      else if (!yaTerminados.has(episodeId)) {
        terminados.push({
          user_id: env.userId,
          episode_id: episodeId,
          watched_at: g.finishedAt ?? new Date().toISOString(),
          source: SOURCE,
        });
      }
    }

    if (g.rating !== null) {
      if (yaPuntuados.has(titleId)) notasQueYaEstaban++;
      else {
        // Las mismas claves en todas las filas, por lo mismo que en las altas.
        notas.push({
          user_id: env.userId,
          title_id: titleId,
          score: g.rating,
          created_at: g.ratedAt ?? ahora,
          updated_at: g.ratedAt ?? ahora,
        });
      }
    }
  }

  console.log(
    `\nPlan:\n` +
      `  biblioteca      : ${nuevas.length} altas, ${parches.length} filas que se completan\n` +
      `  terminados      : ${terminados.length} (${yaTerminados.size} ya lo estaban)\n` +
      `  notas           : ${notas.length} (${notasQueYaEstaban} ya tenían nota)\n` +
      `  sin resolver    : ${noEncontrados.length}\n` +
      `  errores         : ${errores.length}\n` +
      `  conflictos      : ${conflictos.length} (se dejan como están)`,
  );
  for (const c of conflictos.slice(0, 20)) console.log(`    · ${c}`);
  if (conflictos.length > 20) console.log(`    … y ${conflictos.length - 20} más, en el informe`);
  for (const n of noEncontrados) console.log(`    ? ${n}`);
  for (const e of errores.slice(0, 10)) console.log(`    x ${e}`);
  if (sinEpisodio) console.log(`  ! ${sinEpisodio} terminados sin episodio sintético — no se marcan`);

  const informe = {
    cuando: new Date().toISOString(),
    dryRun,
    usuario: env.userId,
    total: games.length,
    resueltos: listos.length,
    altas: nuevas.length,
    completadas: parches.length,
    terminados: terminados.length,
    notas: notas.length,
    notasQueYaEstaban,
    sinEpisodio,
    noEncontrados,
    errores,
    conflictos,
    skipped,
  };

  if (dryRun) {
    writeFileSync(join(dir, "reel-import-plan.json"), JSON.stringify(informe, null, 2));
    console.log(`\nDry run: nada escrito. Plan en ${join(dir, "reel-import-plan.json")}`);
    return;
  }

  /* 4. Escribir ------------------------------------------------------------ */
  // Las altas van en lotes con las MISMAS columnas en todas las filas: PostgREST
  // rechaza un POST de objetos con claves distintas ("All object keys must
  // match"), así que las opcionales se rellenan arriba en vez de omitirse.
  for (const lote of chunk(nuevas, 200)) {
    await req(`${env.url}/rest/v1/library_entries?on_conflict=user_id,title_id`, {
      method: "POST",
      headers: headers(env, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(lote),
    });
  }
  console.log(`  biblioteca: ${nuevas.length} altas`);

  // Los parches van de uno en uno porque cada fila completa cosas distintas.
  // Son pocos por definición: solo lo que ya estaba en la cuenta.
  for (const p of parches) {
    await req(
      `${env.url}/rest/v1/library_entries?user_id=eq.${env.userId}&title_id=eq.${p.titleId}`,
      { method: "PATCH", headers: headers(env, "return=minimal"), body: JSON.stringify(p.patch) },
    );
  }
  console.log(`  biblioteca: ${parches.length} filas completadas`);

  let conFecha = 0;
  for (const [fecha, ids] of playedAt) {
    for (const trozo of chunk(ids, ID_PAGE)) {
      await req(
        `${env.url}/rest/v1/library_entries?user_id=eq.${env.userId}&title_id=in.(${trozo.join(",")})`,
        { method: "PATCH", headers: headers(env, "return=minimal"), body: JSON.stringify({ played_at: fecha }) },
      );
      conFecha += trozo.length;
    }
  }
  console.log(`  played_at: ${conFecha} filas con la fecha del export`);

  for (const lote of chunk(terminados, 200)) {
    await req(`${env.url}/rest/v1/watch_events?on_conflict=user_id,episode_id`, {
      method: "POST",
      headers: headers(env, "resolution=ignore-duplicates,return=minimal"),
      body: JSON.stringify(lote),
    });
  }
  console.log(`  terminados: ${terminados.length}`);

  for (const lote of chunk(notas, 200)) {
    await req(`${env.url}/rest/v1/ratings?on_conflict=user_id,title_id`, {
      method: "POST",
      headers: headers(env, "resolution=ignore-duplicates,return=minimal"),
      body: JSON.stringify(lote),
    });
  }
  console.log(`  notas: ${notas.length}`);

  writeFileSync(join(dir, "reel-import-report.json"), JSON.stringify(informe, null, 2));
  console.log(`\nInforme en ${join(dir, "reel-import-report.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
