/**
 * FilmAffinity → Reel: importador de un solo uso (votos + lista "quiero ver").
 *
 * RUN (contra el proyecto hosted):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TMDB_API_KEY=... \
 *   TARGET_USER_ID=<profiles.id> \
 *   npx tsx index.ts <fa-export.json> [--dry-run] [--sin cortos,mediometrajes,tv]
 *
 * El JSON de entrada lo produce el scrape desde el navegador (README): la
 * sesión de FilmAffinity vive en Chrome, no aquí, así que este guión no habla
 * con filmaffinity.com — recibe lo ya recogido y se ocupa del resto.
 *
 * Qué escribe, por película emparejada:
 *   · `titles` + su episodio sintético — pero NO a mano: se pide
 *     `tmdb-proxy /movie/:id`, que es el mismo camino que abre una ficha en la
 *     app. Así la fila queda con TODAS sus columnas (saga, plataformas, fechas
 *     de estreno por país) y no con las cuatro que este guión sabría rellenar.
 *   · `library_entries(followed)` — sin esto la peli no está en la biblioteca,
 *     que es lo que hace `useMarkWatched` al marcar algo de una peli no seguida.
 *   · `watch_events(watched_at = fecha del voto)` para los votos.
 *   · `ratings(score = voto de FA)` — la escala de FA es 1..10, la de Reel
 *     también, así que la nota viaja tal cual.
 *
 * Lo que NO pisa: una nota o una marca que ya existieran en Reel. Los inserts
 * van con `ignoreDuplicates`, y lo que se salta sale contado en el informe.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  confirmDirector,
  faDateToIso,
  keepItem,
  listAddedAt,
  FA_ALIASES,
  pickMatch,
  searchMovies,
  OPTIONAL_TYPES,
  type FaItem,
  type OptionalType,
} from "./lib.ts";

interface Env {
  supabaseUrl: string;
  serviceKey: string;
  tmdbKey: string;
  targetUserId: string;
}

function readEnv(): Env {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Falta la variable de entorno ${k}`);
    return v;
  };
  return {
    supabaseUrl: need("SUPABASE_URL"),
    serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    tmdbKey: need("TMDB_API_KEY"),
    targetUserId: need("TARGET_USER_ID"),
  };
}

const SOURCE = "filmaffinity_import";

interface Resolved {
  fa: FaItem;
  tmdbId: number;
  tmdbTitle: string;
  tmdbYear: string;
  confidence: string;
  why: string;
}

interface Report {
  matched: Resolved[];
  unmatched: { fa: FaItem; reason: string }[];
  titles: number;
  watchEvents: number;
  ratings: number;
  library: number;
  skippedRatings: number;
  skippedWatches: number;
  errors: string[];
}

/** El emparejamiento de una fila: búsqueda, criba y —si el título solo encajaba
 *  a medias— la llamada de más que confirma el director. */
async function resolveOne(tmdbKey: string, fa: FaItem): Promise<Resolved | { reason: string }> {
  const alias = FA_ALIASES[fa.id];
  if (alias) {
    return { fa, tmdbId: alias, tmdbTitle: fa.title, tmdbYear: fa.year, confidence: "alias", why: "alias a mano" };
  }
  const candidates = await searchMovies(tmdbKey, fa);
  if (!candidates.length) return { reason: "TMDB no devuelve nada para ese título" };
  const match = pickMatch(fa, candidates);
  if (!match) return { reason: `ningún candidato con título y año compatibles (${candidates.length} vistos)` };
  if (match.confidence === "needs-director") {
    const ok = await confirmDirector(tmdbKey, match.candidate.id, fa.director);
    if (!ok) return { reason: `título parcial y el director no confirma (${match.candidate.title})` };
  }
  return {
    fa,
    tmdbId: match.candidate.id,
    tmdbTitle: match.candidate.title,
    tmdbYear: (match.candidate.release_date ?? "").slice(0, 4),
    confidence: match.confidence,
    why: match.why,
  };
}

/** Cachea la ficha de TMDB pidiéndosela a tmdb-proxy, igual que la app al abrir
 *  una película, y devuelve el id del título y el de su episodio sintético.
 *
 *  La llave es la de servicio: tmdb-proxy la reconoce como el cron y salta la
 *  puerta de invitados, que es de usuarios y aquí no hay ninguno detrás. */
async function warmMovie(
  env: Env,
  tmdbId: number,
): Promise<{ titleId: string; episodeId: string | null }> {
  // Tres intentos con espera creciente ante un 5xx. En mil trescientas llamadas
  // seguidas, el aislado de la función se cae alguna vez sola —un 555 suelto en
  // la primera pasada, y la película se quedó fuera por eso y por nada más—.
  // Un 4xx no se reintenta: eso no mejora esperando.
  let last = "";
  for (let intento = 1; intento <= 3; intento++) {
    const res = await fetch(`${env.supabaseUrl}/functions/v1/tmdb-proxy/movie/${tmdbId}`, {
      headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
    });
    if (res.ok) {
      const body = (await res.json()) as { title?: { id?: string }; episode_id?: string | null };
      const titleId = body.title?.id;
      if (!titleId) throw new Error(`tmdb-proxy /movie/${tmdbId}: respuesta sin título`);
      return { titleId, episodeId: body.episode_id ?? null };
    }
    last = `${res.status} ${(await res.text()).slice(0, 200)}`;
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, intento * 1500));
  }
  throw new Error(`tmdb-proxy /movie/${tmdbId}: ${last}`);
}

/** Que la llave sea la que tmdb-proxy reconoce, ANTES de escribir nada.
 *
 *  La función compara el bearer con su `SUPABASE_SERVICE_ROLE_KEY` inyectado, y
 *  en este proyecto ese valor es la `sb_secret_…` del sistema nuevo de claves
 *  —`SUPABASE_DEFAULT_KEY` en la salida del CLI—, no el JWT `service_role`
 *  legacy. Con el JWT, PostgREST contesta que sí y tmdb-proxy que "not invited":
 *  la mitad de las escrituras saldría bien y ninguna ficha se cachearía. Un 403
 *  en la película 1.000 es un desastre silencioso; aquí es una línea. */
async function preflight(env: Env): Promise<void> {
  // 278 = Cadena perpetua. Cualquier id sirve: lo que se está probando es la
  // puerta, y una película que medio mundo tiene cacheada no cuesta ni una
  // llamada a TMDB.
  const res = await fetch(`${env.supabaseUrl}/functions/v1/tmdb-proxy/movie/278`, {
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  if (res.ok) return;
  const body = (await res.text()).slice(0, 120);
  throw new Error(
    `tmdb-proxy rechaza la llave (${res.status} ${body}).\n` +
      `SUPABASE_SERVICE_ROLE_KEY tiene que ser la sb_secret_… del proyecto:\n` +
      `  supabase projects api-keys --project-ref <ref> --reveal -o env | grep '^SUPABASE_DEFAULT_KEY='`,
  );
}

/** Deja la película seguida, con la MISMA regla que la app.
 *
 *  `ensureFollowed` en app/src/lib/watch.ts marca `followed` al ver algo de un
 *  título no seguido, y respeta una sola cosa: `stopped`. Un simple upsert con
 *  `ignoreDuplicates` no hace eso — una fila vieja con `followed = false` se
 *  queda como está, y entonces la nota y la marca se escriben sobre un título
 *  que la biblioteca no enseña (rpc_library_rollup filtra por `followed`).
 *  Vista y sin aparecer en "Tu cine": el peor de los dos mundos.
 *
 *  Devuelve si la fila se ha tocado, para que el informe cuente escrituras. */
async function ensureFollowed(
  admin: SupabaseClient,
  userId: string,
  titleId: string,
  addedAt: string,
): Promise<boolean> {
  const { data: previa, error: le } = await admin
    .from("library_entries")
    .select("followed, stopped")
    .eq("user_id", userId)
    .eq("title_id", titleId)
    .maybeSingle();
  if (le) throw new Error(`library_entries (lectura): ${le.message}`);
  if (previa?.stopped || previa?.followed) return false;

  const { error } = await admin.from("library_entries").upsert(
    // `added_at` solo cuando la fila nace: en una que ya existía, la fecha en
    // que se añadió a Reel es un hecho anterior a esta importación.
    previa
      ? { user_id: userId, title_id: titleId, followed: true }
      : { user_id: userId, title_id: titleId, followed: true, added_at: addedAt },
    { onConflict: "user_id,title_id" },
  );
  if (error) throw new Error(`library_entries: ${error.message}`);
  return true;
}

/** Le pone a cada nota importada la fecha del voto en su propio `created_at`.
 *
 *  Hace falta porque esa columna NO es papeleo: es con la que el muro de amigos
 *  fecha el verbo "rated" (0077_added_agrupado.sql). Dejarla en el `now()` por
 *  omisión pone mil notas de quince años en el día de hoy — y en un muro
 *  compartido eso no es un detalle tuyo, es una avalancha que entierra la
 *  actividad de todos tus amigos bajo algo que nunca ocurrió.
 *
 *  La fecha NO se saca del JSON ni del informe: se saca de los `watch_events`
 *  que escribió la propia importación, que ya la llevan. Así la reparación no
 *  depende de conservar ficheros, arregla exactamente lo que este guión escribió
 *  (`source = 'filmaffinity_import'`) y no puede fechar la nota en un día
 *  distinto del que dice la marca de vista.
 *
 *  Idempotente: dos pasadas dejan lo mismo. */
async function fecharNotas(admin: SupabaseClient, userId: string): Promise<void> {
  // Paginado, porque son mil y pico y PostgREST devuelve mil sin decirlo.
  const vistas: { watched_at: string; episodes: { title_id: string } }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("watch_events")
      .select("watched_at, episodes!inner(title_id)")
      .eq("user_id", userId)
      .eq("source", SOURCE)
      .order("watched_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`watch_events: ${error.message}`);
    vistas.push(...((data ?? []) as unknown as typeof vistas));
    if (!data || data.length < 1000) break;
  }
  console.log(`${vistas.length} vistas de ${SOURCE} con su fecha`);

  let tocadas = 0;
  let sinNota = 0;
  for (const v of vistas) {
    const { data: filas, error } = await admin
      .from("ratings")
      .update({ created_at: v.watched_at, updated_at: v.watched_at })
      .eq("user_id", userId)
      .eq("title_id", v.episodes.title_id)
      .select("id");
    if (error) throw new Error(`ratings: ${error.message}`);
    if (!filas?.length) { sinNota++; continue; }
    if (++tocadas % 100 === 0) console.log(`  notas ${tocadas}/${vistas.length}`);
  }
  console.log(`\n--fechas-notas: ${tocadas} notas fechadas con su voto, ${sinNota} vistas sin nota`);
}

/** Los ids de episodio de una película, para cuando tmdb-proxy devuelve el
 *  título ya cacheado pero sin `episode_id` (fila escrita antes del trigger). */
async function episodeOf(admin: SupabaseClient, titleId: string): Promise<string | null> {
  const { data } = await admin.from("episodes").select("id").eq("title_id", titleId).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // `--fechas-notas` se resuelve entero contra la base y no lee el JSON: la
  // fecha la sacan de los watch_events que la propia importación escribió. Por
  // eso va antes de exigir el fichero — pedirlo sería pedir un fichero que
  // nadie va a abrir, y esa reparación tiene que poder lanzarse meses después,
  // cuando el export ya no esté en ningún disco.
  if (args.includes("--fechas-notas")) {
    const envNotas = readEnv();
    const adminNotas = createClient(envNotas.supabaseUrl, envNotas.serviceKey, { auth: { persistSession: false } });
    await fecharNotas(adminNotas, envNotas.targetUserId);
    return;
  }

  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("uso: tsx index.ts <fa-export.json> [--dry-run] [--sin corto,medio,tv]");

  const sinArg = args.find((a) => a.startsWith("--sin="));
  const pedidos = (sinArg ? sinArg.slice("--sin=".length).split(",") : []).map((s) => s.trim()).filter(Boolean);
  // Un valor que no existe se descartaba en silencio, y `--sin=cortos` (que no
  // es ninguno de los tipos de FA) importaba los cortos igual mientras quien lo
  // escribió creía haberlos dejado fuera. Una exclusión que no excluye tiene que
  // doler en el momento, no en el informe.
  const desconocidos = pedidos.filter((s) => !(OPTIONAL_TYPES as readonly string[]).includes(s));
  if (desconocidos.length) {
    throw new Error(
      `--sin: no conozco ${desconocidos.join(", ")}. Los tipos opcionales son: ${OPTIONAL_TYPES.join(", ")}`,
    );
  }
  const exclude = pedidos as OptionalType[];

  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });

  const raw = JSON.parse(readFileSync(file, "utf8")) as { votes: FaItem[]; list: FaItem[] };
  const votes = raw.votes.filter((v) => keepItem(v.types, exclude));
  // Una peli votada Y en la lista es una peli ya vista: manda el voto, y de la
  // lista se cae para no volver a meterla como pendiente.
  const votedIds = new Set(votes.map((v) => v.id));
  const seenInList = new Set<string>();
  const list = raw.list.filter((v) => {
    if (!keepItem(v.types, exclude) || votedIds.has(v.id) || seenInList.has(v.id)) return false;
    seenInList.add(v.id);
    return true;
  });

  console.log(
    `${file}${dryRun ? " (dry run)" : ""}: ${raw.votes.length} votos → ${votes.length} de cine, ` +
      `${raw.list.length} filas de lista → ${list.length} pendientes` +
      `${exclude.length ? ` (fuera: ${exclude.join(", ")})` : ""}`,
  );

  const report: Report = {
    matched: [], unmatched: [], titles: 0, watchEvents: 0, ratings: 0, library: 0,
    skippedRatings: 0, skippedWatches: 0, errors: [],
  };

  // ── 1. Emparejar todo contra TMDB ────────────────────────────────────────
  const all = [...votes.map((fa) => ({ fa, kind: "vote" as const })), ...list.map((fa) => ({ fa, kind: "list" as const }))];
  const resolved = new Map<string, Resolved>();
  let done = 0;

  // Reaprovechar el informe de un dry run anterior: el emparejamiento son ~2.700
  // peticiones a TMDB y veinte minutos, y repetirlo no cambia el resultado. Sirve
  // además para que lo que se escribe sea EXACTAMENTE lo que se revisó.
  const desde = args.find((a) => a.startsWith("--desde-informe="))?.slice("--desde-informe=".length);
  if (desde) {
    const previo = JSON.parse(readFileSync(desde, "utf8")) as Report;
    for (const m of previo.matched) resolved.set(m.fa.id, m);
    report.matched = previo.matched;
    report.unmatched = previo.unmatched;
    console.log(`emparejamiento leído de ${desde}: ${report.matched.length} con TMDB, ${report.unmatched.length} sin match`);
    // Una fila que hoy está en el JSON y no en aquel informe se quedaría fuera
    // sin decir nada: el informe manda, pero la diferencia se canta.
    const faltan = all.filter(({ fa }) => !resolved.has(fa.id) && !previo.unmatched.some((u) => u.fa.id === fa.id));
    if (faltan.length) console.log(`  OJO: ${faltan.length} filas del JSON no están en ese informe y no se importarán`);
  } else {
    for (const { fa } of all) {
      try {
        const r = await resolveOne(env.tmdbKey, fa);
        if ("reason" in r) report.unmatched.push({ fa, reason: r.reason });
        else { resolved.set(fa.id, r); report.matched.push(r); }
      } catch (err) {
        report.unmatched.push({ fa, reason: `error: ${(err as Error).message}` });
      }
      if (++done % 50 === 0) console.log(`  emparejando ${done}/${all.length} — ${report.matched.length} con TMDB`);
    }
    console.log(`\nemparejados ${report.matched.length}/${all.length}, sin match ${report.unmatched.length}`);
  }

  if (dryRun) {
    writeFileSync("match-report.json", JSON.stringify(report, null, 2));
    console.log("dry run: nada escrito. Informe en match-report.json");
    return;
  }

  // ── 2. Cachear fichas y escribir el perfil ───────────────────────────────
  // La puerta se comprueba solo si vamos a llamarla: `--fechas-lista` no toca
  // tmdb-proxy, y hacerle depender de que la edge function esté en pie sería
  // pedirle una llave que no necesita.
  if (!args.includes("--fechas-lista")) await preflight(env);
  // `--solo=<id de FA,…>` reescribe unas pocas filas y nada más. Existe por lo
  // que pasó en la primera pasada de verdad: una película se perdió por un 5xx
  // suelto, y repetir las mil trescientas para recuperar UNA es media hora de
  // peticiones que ya estaban bien.
  const soloArg = args.find((a) => a.startsWith("--solo="))?.slice("--solo=".length);
  const solo = soloArg ? new Set(soloArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  if (solo) console.log(`--solo: ${solo.size} filas`);

  // El momento al que se cuelgan las filas de lista. Por defecto, ahora. Se pasa
  // a mano para REPARAR una importación anterior: los segundos se recalculan
  // sobre el instante en que aquella escribió, no sobre el de hoy.
  const baseArg = args.find((a) => a.startsWith("--base-lista="))?.slice("--base-lista=".length);
  if (baseArg && Number.isNaN(Date.parse(baseArg))) throw new Error(`--base-lista: "${baseArg}" no es una fecha`);
  const baseLista = baseArg ? new Date(baseArg) : new Date();
  // El denominador del progreso es lo que ESTA pasada va a escribir, no el
  // emparejamiento entero: con --solo decía "12/1325" sobre una sola fila.
  const porEscribir = all.filter(({ fa }) => resolved.has(fa.id) && (!solo || solo.has(fa.id))).length;

  // `--fechas-notas` le pone a cada nota la fecha del voto en su propio
  // `created_at`. No es cosmético: es la columna con la que el muro de amigos
  // fecha el verbo "rated" (0077_added_agrupado.sql), así que mil notas
  // importadas con el `now()` por omisión salen todas como votadas hoy —y
  // sepultan la actividad de todos los amigos bajo una avalancha que nunca
  // ocurrió. La reparación de una pasada anterior; el importador ya la escribe
  // bien de origen.
  // `--fechas-lista` no importa nada: solo recoloca el `added_at` de las filas
  // de lista según su puesto en FA. Es la reparación de una pasada anterior, y
  // no toca ni TMDB ni tmdb-proxy — los títulos ya están cacheados.
  if (args.includes("--fechas-lista")) {
    let tocadas = 0;
    for (const { fa, kind } of all) {
      if (kind !== "list" || !fa.position) continue;
      if (solo && !solo.has(fa.id)) continue;
      const r = resolved.get(fa.id);
      if (!r) continue;
      const { data: t, error: te } = await admin
        .from("titles").select("id").eq("kind", "movie").eq("tmdb_id", r.tmdbId).maybeSingle();
      if (te) throw new Error(`titles: ${te.message}`);
      if (!t) { report.errors.push(`${fa.title}: la ficha no está cacheada`); continue; }
      // `.select()` para contar filas TOCADAS y no vueltas del bucle: un update
      // que no encuentra su fila no es un error en PostgREST, y sin esto una
      // película que no esté en la biblioteca se contaría como recolocada.
      const { data: filas, error } = await admin
        .from("library_entries")
        .update({ added_at: listAddedAt(baseLista, fa.position) })
        .eq("user_id", env.targetUserId)
        .eq("title_id", t.id)
        .select("title_id");
      if (error) throw new Error(`library_entries: ${error.message}`);
      if (!filas?.length) { report.errors.push(`${fa.title}: no está en la biblioteca`); continue; }
      if (++tocadas % 50 === 0) console.log(`  fechas ${tocadas}`);
    }
    console.log(`\n--fechas-lista: ${tocadas} filas recolocadas desde ${baseLista.toISOString()}`);
    if (report.errors.length) {
      console.log(`  ${report.errors.length} sin tocar:`);
      report.errors.slice(0, 10).forEach((e) => console.log(`    ${e}`));
    }
    return;
  }

  done = 0;
  for (const { fa, kind } of all) {
    if (solo && !solo.has(fa.id)) continue;
    const r = resolved.get(fa.id);
    if (!r) continue;
    try {
      const { titleId, episodeId: fromProxy } = await warmMovie(env, r.tmdbId);
      report.titles++;

      // Un voto trae su fecha y esa es la buena. Una fila de lista no tiene
      // ninguna —FA no la guarda—, así que lleva el momento de la importación
      // con los segundos repartidos por su puesto en la lista (ver listAddedAt).
      const addedAt =
        (fa.date && faDateToIso(fa.date)) ||
        (fa.position ? listAddedAt(baseLista, fa.position) : baseLista.toISOString());
      if (await ensureFollowed(admin, env.targetUserId, titleId, addedAt)) report.library++;

      if (kind === "vote") {
        const episodeId = fromProxy ?? (await episodeOf(admin, titleId));
        if (!episodeId) throw new Error("la película no tiene episodio sintético");
        // `.select()` con ignoreDuplicates devuelve SOLO lo insertado, así que
        // el contador cuenta escrituras y no intentos: sin él el informe decía
        // "1.005 vistas" tanto si eran nuevas como si ya estaban marcadas.
        const { data: nuevas, error: we } = await admin
          .from("watch_events")
          .upsert({ user_id: env.targetUserId, episode_id: episodeId, watched_at: addedAt, source: SOURCE }, {
            onConflict: "user_id,episode_id",
            ignoreDuplicates: true,
          })
          .select("id");
        if (we) throw new Error(`watch_events: ${we.message}`);
        if (nuevas?.length) report.watchEvents++;
        else report.skippedWatches++;

        if (fa.rating != null) {
          const { data: had } = await admin
            .from("ratings")
            .select("score")
            .eq("user_id", env.targetUserId)
            .eq("title_id", titleId)
            .maybeSingle();
          if (had) report.skippedRatings++;
          else {
            // `created_at` es la fecha del voto, no la de la importación: es la
            // columna con la que el muro de amigos fecha el verbo "rated"
            // (0077_added_agrupado.sql), así que dejarla por omisión pone mil
            // notas de quince años en el día de hoy y sepulta la actividad de
            // todo el mundo. `updated_at` va con ella porque la fila se escribe
            // una vez: decir que se tocó después sería falso.
            const { error: re } = await admin.from("ratings").insert({
              user_id: env.targetUserId,
              title_id: titleId,
              score: fa.rating,
              created_at: addedAt,
              updated_at: addedAt,
            });
            if (re) throw new Error(`ratings: ${re.message}`);
            report.ratings++;
          }
        }
      }
    } catch (err) {
      report.errors.push(`${fa.title} (${fa.year}): ${(err as Error).message}`);
    }
    if (++done % 25 === 0) {
      console.log(`  escribiendo ${done}/${porEscribir} — ${report.watchEvents} vistas, ${report.ratings} notas`);
    }
  }

  writeFileSync("import-report.json", JSON.stringify(report, null, 2));
  console.log("\n── Resumen ─────────────────────────");
  console.log(`  emparejados    : ${report.matched.length}`);
  console.log(`  sin match      : ${report.unmatched.length}`);
  console.log(`  fichas cacheadas: ${report.titles}`);
  console.log(`  en biblioteca  : ${report.library} (nuevas o vueltas a seguir)`);
  console.log(`  vistas         : ${report.watchEvents} (${report.skippedWatches} ya estaban marcadas)`);
  console.log(`  notas          : ${report.ratings} (${report.skippedRatings} ya tenían nota en Reel)`);
  console.log(`  errores        : ${report.errors.length}`);
  console.log("  informe        : import-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
