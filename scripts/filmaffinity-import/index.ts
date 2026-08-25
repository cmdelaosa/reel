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
  errors: string[];
}

/** El emparejamiento de una fila: búsqueda, criba y —si el título solo encajaba
 *  a medias— la llamada de más que confirma el director. */
async function resolveOne(tmdbKey: string, fa: FaItem): Promise<Resolved | { reason: string }> {
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
  const res = await fetch(`${env.supabaseUrl}/functions/v1/tmdb-proxy/movie/${tmdbId}`, {
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  if (!res.ok) throw new Error(`tmdb-proxy /movie/${tmdbId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { title?: { id?: string }; episode_id?: string | null };
  const titleId = body.title?.id;
  if (!titleId) throw new Error(`tmdb-proxy /movie/${tmdbId}: respuesta sin título`);
  return { titleId, episodeId: body.episode_id ?? null };
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

/** Los ids de episodio de una película, para cuando tmdb-proxy devuelve el
 *  título ya cacheado pero sin `episode_id` (fila escrita antes del trigger). */
async function episodeOf(admin: SupabaseClient, titleId: string): Promise<string | null> {
  const { data } = await admin.from("episodes").select("id").eq("title_id", titleId).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("uso: tsx index.ts <fa-export.json> [--dry-run] [--sin corto,medio,tv]");

  const sinArg = args.find((a) => a.startsWith("--sin="));
  const exclude = (sinArg ? sinArg.slice("--sin=".length).split(",") : [])
    .map((s) => s.trim())
    .filter((s): s is OptionalType => (OPTIONAL_TYPES as readonly string[]).includes(s));

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
    matched: [], unmatched: [], titles: 0, watchEvents: 0, ratings: 0, library: 0, skippedRatings: 0, errors: [],
  };

  // ── 1. Emparejar todo contra TMDB ────────────────────────────────────────
  const all = [...votes.map((fa) => ({ fa, kind: "vote" as const })), ...list.map((fa) => ({ fa, kind: "list" as const }))];
  const resolved = new Map<string, Resolved>();
  let done = 0;
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

  if (dryRun) {
    writeFileSync("match-report.json", JSON.stringify(report, null, 2));
    console.log("dry run: nada escrito. Informe en match-report.json");
    return;
  }

  // ── 2. Cachear fichas y escribir el perfil ───────────────────────────────
  await preflight(env);
  done = 0;
  for (const { fa, kind } of all) {
    const r = resolved.get(fa.id);
    if (!r) continue;
    try {
      const { titleId, episodeId: fromProxy } = await warmMovie(env, r.tmdbId);
      report.titles++;

      const addedAt = (fa.date && faDateToIso(fa.date)) || new Date().toISOString();
      const { error: le } = await admin
        .from("library_entries")
        .upsert({ user_id: env.targetUserId, title_id: titleId, followed: true, added_at: addedAt }, {
          onConflict: "user_id,title_id",
          ignoreDuplicates: true,
        });
      if (le) throw new Error(`library_entries: ${le.message}`);
      report.library++;

      if (kind === "vote") {
        const episodeId = fromProxy ?? (await episodeOf(admin, titleId));
        if (!episodeId) throw new Error("la película no tiene episodio sintético");
        const { error: we } = await admin
          .from("watch_events")
          .upsert({ user_id: env.targetUserId, episode_id: episodeId, watched_at: addedAt, source: SOURCE }, {
            onConflict: "user_id,episode_id",
            ignoreDuplicates: true,
          });
        if (we) throw new Error(`watch_events: ${we.message}`);
        report.watchEvents++;

        if (fa.rating != null) {
          const { data: had } = await admin
            .from("ratings")
            .select("score")
            .eq("user_id", env.targetUserId)
            .eq("title_id", titleId)
            .maybeSingle();
          if (had) report.skippedRatings++;
          else {
            const { error: re } = await admin
              .from("ratings")
              .insert({ user_id: env.targetUserId, title_id: titleId, score: fa.rating });
            if (re) throw new Error(`ratings: ${re.message}`);
            report.ratings++;
          }
        }
      }
    } catch (err) {
      report.errors.push(`${fa.title} (${fa.year}): ${(err as Error).message}`);
    }
    if (++done % 25 === 0) {
      console.log(`  escribiendo ${done}/${resolved.size} — ${report.watchEvents} vistas, ${report.ratings} notas`);
    }
  }

  writeFileSync("import-report.json", JSON.stringify(report, null, 2));
  console.log("\n── Resumen ─────────────────────────");
  console.log(`  emparejados    : ${report.matched.length}`);
  console.log(`  sin match      : ${report.unmatched.length}`);
  console.log(`  fichas cacheadas: ${report.titles}`);
  console.log(`  en biblioteca  : ${report.library}`);
  console.log(`  vistas         : ${report.watchEvents}`);
  console.log(`  notas          : ${report.ratings} (${report.skippedRatings} ya tenían nota en Reel)`);
  console.log(`  errores        : ${report.errors.length}`);
  console.log("  informe        : import-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
