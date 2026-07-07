/**
 * TV Time GDPR-export → Supabase seed importer (P0-C10).
 *
 * Reconstructs the author's library from a TV Time export directory and writes
 * it for one target user: follow set + watch history. Metadata (title/season/
 * episode) is fetched from TMDB and upserted mirroring the tmdb-proxy shape.
 *
 * WATCH STATE: TV Time stores `nb_episodes_seen` per show (user_tv_show_data.csv)
 * — the total episodes seen. TV Time's binge model means these are the first N
 * episodes in air order, so we mark the first `nb_episodes_seen` episodes
 * (regular seasons only, season 0 specials excluded). The per-show counts sum to
 * 9196, matching user_statistics.
 *
 * RATINGS: the export's only ratings are a handful of *episode* votes whose score
 * is encoded ambiguously (vote_key tail is not a 1-10 value), and v1 ships
 * show-level ratings only. So ratings are SKIPPED (logged) — revisit if a
 * decodable show-rating source appears.
 *
 * RUN (against a local `supabase start` or a hosted project):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TMDB_API_KEY=... \
 *   TARGET_USER_ID=<profiles.id> \
 *   npx tsx index.ts <path-to-export-dir> [--dry-run]
 *
 * The service-role key bypasses RLS. The export stays OUTSIDE the repo (it holds
 * a live OAuth token + password hash — see DESIGN.md).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readTable, requireColumns } from "./csv.ts";

// Verified against the real export headers (2026-07).
const SOURCE = {
  file: "user_tv_show_data.csv",
  tvdbId: "tv_show_id", // TheTVDB series id
  name: "tv_show_name",
  followed: "is_followed", // "1" | "0"
  favorite: "is_favorited",
  seen: "nb_episodes_seen",
} as const;

const TMDB = "https://api.themoviedb.org/3";
const AIR_TIME = "T21:00:00Z";

interface Show {
  tvdbId: string;
  name: string;
  followed: boolean;
  favorite: boolean;
  seen: number;
}
interface Report {
  shows: number;
  followed: number;
  matched: number;
  matchedFollowed: number;
  unmatched: { tvdbId: string; name: string }[];
  errors: { tvdbId: string; name: string; error: string }[];
  titles: number;
  watchEvents: number;
  dryRun: boolean;
}

type Json = Record<string, unknown>;

function readEnv() {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing env var ${k}`);
    return v;
  };
  return {
    supabaseUrl: need("SUPABASE_URL"),
    serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    tmdbKey: need("TMDB_API_KEY"),
    targetUserId: need("TARGET_USER_ID"),
  };
}

const tmdbFetch = (key: string, path: string): Promise<Json> =>
  fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`).then(
    (r) => r.json() as Promise<Json>,
  );

/** TheTVDB series id → TMDB tv id via the cross-reference endpoint. */
async function tvdbToTmdb(key: string, tvdbId: string): Promise<number | null> {
  const data = await tmdbFetch(key, `/find/${tvdbId}?external_source=tvdb_id`);
  const results = (data.tv_results as Json[] | undefined) ?? [];
  return results[0] ? (results[0].id as number) : null;
}

const airDatetime = (d?: string | null) => (d ? `${d}${AIR_TIME}` : null);

function loadShows(dir: string): Show[] {
  const table = readTable(join(dir, SOURCE.file));
  requireColumns(table, SOURCE.file, [SOURCE.tvdbId, SOURCE.followed, SOURCE.seen]);
  return table.rows
    .map((r) => ({
      tvdbId: r[SOURCE.tvdbId],
      name: r[SOURCE.name] ?? "",
      followed: r[SOURCE.followed] === "1",
      favorite: r[SOURCE.favorite] === "1",
      seen: Number(r[SOURCE.seen] || 0),
    }))
    .filter((s) => s.tvdbId && (s.followed || s.seen > 0));
}

async function upsertTitle(admin: SupabaseClient, d: Json): Promise<string> {
  const genres = ((d.genres as Json[] | undefined) ?? []).map((g) => g.name as string);
  const networks = (d.networks as Json[] | undefined) ?? [];
  const runtimes = (d.episode_run_time as number[] | undefined) ?? [];
  const { data, error } = await admin
    .from("titles")
    .upsert(
      {
        tmdb_id: d.id,
        kind: "tv",
        name: (d.name as string) ?? "Untitled",
        overview: (d.overview as string) ?? null,
        poster_path: (d.poster_path as string) ?? null,
        backdrop_path: (d.backdrop_path as string) ?? null,
        first_air_date: (d.first_air_date as string) || null,
        status: (d.status as string) ?? null,
        genres,
        network: (networks[0]?.name as string) ?? null,
        episode_run_time: runtimes[0] ?? null,
        vote_average: (d.vote_average as number) ?? null,
        popularity: (d.popularity as number) ?? null,
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "tmdb_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`title upsert: ${error?.message}`);
  return data.id as string;
}

async function upsertSeason(admin: SupabaseClient, titleId: string, s: Json): Promise<string> {
  const { data, error } = await admin
    .from("seasons")
    .upsert(
      {
        title_id: titleId,
        tmdb_id: (s.id as number) ?? null,
        number: s.season_number as number,
        name: (s.name as string) ?? null,
        episode_count: (s.episode_count as number) ?? null,
        air_date: (s.air_date as string) || null,
      },
      { onConflict: "title_id,number" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`season upsert: ${error?.message}`);
  return data.id as string;
}

/** Upsert a season's episodes; return their uuids in episode-number order. */
async function upsertEpisodes(
  admin: SupabaseClient,
  titleId: string,
  seasonId: string,
  eps: Json[],
): Promise<string[]> {
  if (eps.length === 0) return [];
  const rows = eps.map((e) => ({
    title_id: titleId,
    season_id: seasonId,
    tmdb_id: (e.id as number) ?? null,
    season_number: e.season_number as number,
    episode_number: e.episode_number as number,
    name: (e.name as string) ?? null,
    overview: (e.overview as string) ?? null,
    runtime: (e.runtime as number) ?? null,
    air_datetime: airDatetime(e.air_date as string),
  }));
  const { data, error } = await admin
    .from("episodes")
    .upsert(rows, { onConflict: "title_id,season_number,episode_number" })
    .select("id, episode_number");
  if (error) throw new Error(`episodes upsert: ${error.message}`);
  const byNum = new Map((data ?? []).map((r) => [r.episode_number as number, r.id as string]));
  return rows
    .map((r) => byNum.get(r.episode_number))
    .filter((id): id is string => Boolean(id));
}

async function importShow(
  admin: SupabaseClient,
  tmdbKey: string,
  userId: string,
  show: Show,
): Promise<{ matched: boolean; watchEvents: number }> {
  const tmdbId = await tvdbToTmdb(tmdbKey, show.tvdbId);
  if (!tmdbId) return { matched: false, watchEvents: 0 };

  const detail = await tmdbFetch(tmdbKey, `/tv/${tmdbId}`);
  const titleId = await upsertTitle(admin, detail);

  await admin
    .from("library_entries")
    .upsert(
      { user_id: userId, title_id: titleId, followed: show.followed, favorite: show.favorite },
      { onConflict: "user_id,title_id" },
    );

  let watchEvents = 0;
  if (show.seen > 0) {
    const seasons = ((detail.seasons as Json[] | undefined) ?? [])
      .filter((s) => (s.season_number as number) > 0)
      .sort((a, b) => (a.season_number as number) - (b.season_number as number));

    const episodeIds: string[] = [];
    for (const s of seasons) {
      if (episodeIds.length >= show.seen) break;
      const seasonId = await upsertSeason(admin, titleId, s);
      const sd = await tmdbFetch(tmdbKey, `/tv/${tmdbId}/season/${s.season_number}`);
      const eps = ((sd.episodes as Json[] | undefined) ?? []).sort(
        (a, b) => (a.episode_number as number) - (b.episode_number as number),
      );
      episodeIds.push(...(await upsertEpisodes(admin, titleId, seasonId, eps)));
    }

    const watched = episodeIds.slice(0, show.seen);
    if (watched.length > 0) {
      const { error } = await admin.from("watch_events").upsert(
        watched.map((episode_id) => ({ user_id: userId, episode_id, source: "tvtime_import" })),
        { onConflict: "user_id,episode_id" },
      );
      if (error) throw new Error(`watch_events upsert: ${error.message}`);
      watchEvents = watched.length;
    }
  }
  return { matched: true, watchEvents };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: tsx index.ts <export-dir> [--dry-run]");

  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false },
  });

  const shows = loadShows(dir);
  console.log(
    `${dir}${dryRun ? " (dry run)" : ""}: ${shows.length} shows to import ` +
      `(${shows.filter((s) => s.followed).length} followed). Ratings skipped by design.`,
  );

  const report: Report = {
    shows: shows.length,
    followed: shows.filter((s) => s.followed).length,
    matched: 0,
    matchedFollowed: 0,
    unmatched: [],
    errors: [],
    titles: 0,
    watchEvents: 0,
    dryRun,
  };

  let i = 0;
  for (const show of shows) {
    i++;
    try {
      if (dryRun) {
        const tmdbId = await tvdbToTmdb(env.tmdbKey, show.tvdbId);
        if (tmdbId) {
          report.matched++;
          if (show.followed) report.matchedFollowed++;
        } else {
          report.unmatched.push({ tvdbId: show.tvdbId, name: show.name });
        }
      } else {
        const { matched, watchEvents } = await importShow(admin, env.tmdbKey, env.targetUserId, show);
        if (matched) {
          report.matched++;
          report.titles++;
          report.watchEvents += watchEvents;
          if (show.followed) report.matchedFollowed++;
        } else {
          report.unmatched.push({ tvdbId: show.tvdbId, name: show.name });
        }
      }
    } catch (err) {
      report.errors.push({ tvdbId: show.tvdbId, name: show.name, error: (err as Error).message });
    }
    if (i % 25 === 0)
      console.log(`  ${i}/${shows.length} — matched ${report.matched}, watch_events ${report.watchEvents}`);
  }

  const reportPath = join(dir, "import-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n── Summary ─────────────────────────");
  console.log(`  shows processed  : ${report.shows}`);
  console.log(`  followed         : ${report.followed}`);
  console.log(`  matched → TMDB   : ${report.matched} (${report.matchedFollowed} followed)`);
  console.log(`  unmatched        : ${report.unmatched.length}`);
  console.log(`  errors           : ${report.errors.length}`);
  if (!dryRun) {
    console.log(`  titles cached    : ${report.titles}`);
    console.log(`  watch_events     : ${report.watchEvents}`);
  }
  console.log(`  report           : ${reportPath}`);
  if (report.unmatched.length)
    console.log(`  unmatched sample : ${report.unmatched.slice(0, 8).map((u) => u.name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
