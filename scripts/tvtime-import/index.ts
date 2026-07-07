/**
 * TV Time GDPR-export → Supabase seed importer (P0-C10).
 *
 * Reconstructs the author's library from a TV Time export directory: follow set,
 * watch state (latest-seen implies every prior episode seen), and ratings. Maps
 * TheTVDB series ids to TMDB, upserts title/season/episode metadata, then writes
 * library_entries / watch_events / ratings for one target user.
 *
 * RUN (against a local `supabase start` or a hosted project):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TMDB_API_KEY=... \
 *   TARGET_USER_ID=<profiles.id> \
 *   npx tsx index.ts <path-to-export-dir> [--dry-run]
 *
 * The service-role key bypasses RLS. The export zip stays OUTSIDE the repo
 * (it contained a live OAuth token + password hash — see DESIGN.md).
 *
 * ── STATUS ──────────────────────────────────────────────────────────────────
 * Written without the actual export in hand: the COLUMNS map below is a best
 * guess at TV Time's headers. readTable + requireColumns validate them at
 * startup and fail loudly with the real headers if they differ — correct the
 * map and re-run. NOT yet run end-to-end (pending the zip + TMDB_API_KEY).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readTable, requireColumns, type Table } from "./csv.ts";

// ── Column mapping (VERIFY against the real export headers) ──────────────────
const COLUMNS = {
  followed: { file: "followed_tv_show.csv", tvdbId: "tv_show_id", name: "tv_show_name" },
  latest: {
    file: "show_seen_episode_latest.csv",
    tvdbId: "tv_show_id",
    season: "season_number",
    episode: "episode_number",
    at: "last_seen_at",
  },
  seen: {
    file: "seen_episode_source.csv",
    tvdbId: "tv_show_id",
    season: "season_number",
    episode: "episode_number",
    at: "seen_at",
  },
  // Ratings live across three schema generations; each is validated
  // independently and skipped-with-warning if its columns don't match.
  ratings: [
    { file: "ratings-3-prod-episode_votes.csv", tvdbId: "tv_show_id", score: "rating", at: "created_at" },
    { file: "ratings-v2-prod-votes.csv", tvdbId: "tv_show_id", score: "rating", at: "created_at" },
    { file: "ratings-prod-episode_votes.csv", tvdbId: "tv_show_id", score: "rating", at: "created_at" },
  ],
} as const;

const TMDB = "https://api.themoviedb.org/3";
const AIR_TIME = "T21:00:00Z";

// ── Types ────────────────────────────────────────────────────────────────────
interface Env {
  supabaseUrl: string;
  serviceKey: string;
  tmdbKey: string;
  targetUserId: string;
}
interface WatchMark {
  season: number;
  episode: number;
}
interface ShowState {
  tvdbId: string;
  name: string;
  latest?: WatchMark; // highest season/episode seen
  explicit: Set<string>; // "s.e" episodes with a direct seen event
}
interface Rating {
  tvdbId: string;
  score: number; // 1..10
  at: string;
}
interface Report {
  followed: number;
  matched: number;
  unmatched: { tvdbId: string; name: string }[];
  titles: number;
  watchEvents: number;
  ratings: number;
  dryRun: boolean;
}

// ── Env + args ───────────────────────────────────────────────────────────────
function readEnv(): Env {
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

// ── TMDB helpers ─────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;

const tmdbFetch = (key: string, path: string): Promise<Json> =>
  fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`).then(
    (r) => r.json() as Promise<Json>,
  );

/** TheTVDB series id → TMDB tv id via the cross-reference endpoint. */
async function tvdbToTmdb(key: string, tvdbId: string): Promise<number | null> {
  const data = await tmdbFetch(key, `/find/${tvdbId}?external_source=tvdb_id`);
  const results = (data.tv_results as Json[] | undefined) ?? [];
  const first = results[0];
  return first ? (first.id as number) : null;
}

const airDatetime = (d?: string | null) => (d ? `${d}${AIR_TIME}` : null);

// ── Parsing the export ───────────────────────────────────────────────────────
function loadShows(dir: string): Map<string, ShowState> {
  const shows = new Map<string, ShowState>();
  const get = (tvdbId: string, name = ""): ShowState => {
    let s = shows.get(tvdbId);
    if (!s) {
      s = { tvdbId, name, explicit: new Set() };
      shows.set(tvdbId, s);
    }
    if (name && !s.name) s.name = name;
    return s;
  };

  const followed = readTable(join(dir, COLUMNS.followed.file));
  requireColumns(followed, COLUMNS.followed.file, [COLUMNS.followed.tvdbId]);
  for (const r of followed.rows) {
    const id = r[COLUMNS.followed.tvdbId];
    if (id) get(id, r[COLUMNS.followed.name] ?? "");
  }

  const latest = readTable(join(dir, COLUMNS.latest.file));
  requireColumns(latest, COLUMNS.latest.file, [
    COLUMNS.latest.tvdbId,
    COLUMNS.latest.season,
    COLUMNS.latest.episode,
  ]);
  for (const r of latest.rows) {
    const id = r[COLUMNS.latest.tvdbId];
    if (!id) continue;
    const mark: WatchMark = {
      season: Number(r[COLUMNS.latest.season]),
      episode: Number(r[COLUMNS.latest.episode]),
    };
    const s = get(id);
    if (!s.latest || isAfter(mark, s.latest)) s.latest = mark;
  }

  const seen = readTable(join(dir, COLUMNS.seen.file));
  requireColumns(seen, COLUMNS.seen.file, [
    COLUMNS.seen.tvdbId,
    COLUMNS.seen.season,
    COLUMNS.seen.episode,
  ]);
  for (const r of seen.rows) {
    const id = r[COLUMNS.seen.tvdbId];
    if (!id) continue;
    get(id).explicit.add(`${Number(r[COLUMNS.seen.season])}.${Number(r[COLUMNS.seen.episode])}`);
  }

  return shows;
}

/** Union + dedupe ratings across the three schema generations; newest wins. */
function loadRatings(dir: string): Map<string, Rating> {
  const byShow = new Map<string, Rating>();
  const files = new Set(readdirSync(dir));
  for (const cfg of COLUMNS.ratings) {
    if (!files.has(cfg.file)) continue;
    let table: Table;
    try {
      table = readTable(join(dir, cfg.file));
      requireColumns(table, cfg.file, [cfg.tvdbId, cfg.score]);
    } catch (err) {
      console.warn(`  ! skipping ${cfg.file}: ${(err as Error).message}`);
      continue;
    }
    for (const r of table.rows) {
      const id = r[cfg.tvdbId];
      const score = clampScore(Number(r[cfg.score]));
      if (!id || score === null) continue;
      const at = r[cfg.at] ?? "";
      const prev = byShow.get(id);
      if (!prev || at > prev.at) byShow.set(id, { tvdbId: id, score, at });
    }
  }
  return byShow;
}

const isAfter = (a: WatchMark, b: WatchMark) =>
  a.season > b.season || (a.season === b.season && a.episode > b.episode);

/** TV Time ratings are 0..10 (half-steps ×2 in some generations). Normalise to
 *  our 1..10 int scale; return null for anything out of range. */
function clampScore(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const s = Math.round(raw);
  return s >= 1 && s <= 10 ? s : null;
}

// ── Upserts (mirror the tmdb-proxy mapping shape) ────────────────────────────
async function upsertMetadata(
  admin: SupabaseClient,
  tmdbKey: string,
  tmdbId: number,
): Promise<{ titleId: string; episodeIds: Map<string, string> }> {
  const detail = await tmdbFetch(tmdbKey, `/tv/${tmdbId}`);
  const genres = ((detail.genres as Json[] | undefined) ?? []).map((g) => g.name as string);
  const networks = (detail.networks as Json[] | undefined) ?? [];
  const runtimes = (detail.episode_run_time as number[] | undefined) ?? [];

  const { data: title, error: te } = await admin
    .from("titles")
    .upsert(
      {
        tmdb_id: detail.id,
        kind: "tv",
        name: (detail.name as string) ?? "Untitled",
        overview: (detail.overview as string) ?? null,
        poster_path: (detail.poster_path as string) ?? null,
        backdrop_path: (detail.backdrop_path as string) ?? null,
        first_air_date: (detail.first_air_date as string) || null,
        status: (detail.status as string) ?? null,
        genres,
        network: (networks[0]?.name as string) ?? null,
        episode_run_time: runtimes[0] ?? null,
        vote_average: (detail.vote_average as number) ?? null,
        popularity: (detail.popularity as number) ?? null,
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "tmdb_id" },
    )
    .select("id")
    .single();
  if (te || !title) throw new Error(`title upsert (${tmdbId}): ${te?.message}`);
  const titleId = title.id as string;

  const episodeIds = new Map<string, string>(); // "s.e" → episode uuid
  const seasons = ((detail.seasons as Json[] | undefined) ?? []).filter(
    (s) => (s.season_number as number) > 0, // skip specials (season 0)
  );
  for (const s of seasons) {
    const num = s.season_number as number;
    const { data: season, error: se } = await admin
      .from("seasons")
      .upsert(
        {
          title_id: titleId,
          tmdb_id: (s.id as number) ?? null,
          number: num,
          name: (s.name as string) ?? null,
          episode_count: (s.episode_count as number) ?? null,
          air_date: (s.air_date as string) || null,
        },
        { onConflict: "title_id,number" },
      )
      .select("id")
      .single();
    if (se || !season) throw new Error(`season upsert (${tmdbId} s${num}): ${se?.message}`);

    const sd = await tmdbFetch(tmdbKey, `/tv/${tmdbId}/season/${num}`);
    const eps = ((sd.episodes as Json[] | undefined) ?? []).map((e) => ({
      title_id: titleId,
      season_id: season.id as string,
      tmdb_id: (e.id as number) ?? null,
      season_number: e.season_number as number,
      episode_number: e.episode_number as number,
      name: (e.name as string) ?? null,
      overview: (e.overview as string) ?? null,
      runtime: (e.runtime as number) ?? null,
      air_datetime: airDatetime(e.air_date as string),
    }));
    if (eps.length) {
      const { data: saved, error: ee } = await admin
        .from("episodes")
        .upsert(eps, { onConflict: "title_id,season_number,episode_number" })
        .select("id, season_number, episode_number");
      if (ee) throw new Error(`episodes upsert (${tmdbId} s${num}): ${ee.message}`);
      for (const row of saved ?? [])
        episodeIds.set(`${row.season_number}.${row.episode_number}`, row.id as string);
    }
  }
  return { titleId, episodeIds };
}

/** Episodes considered watched: explicit seen events ∪ everything at or before
 *  the latest-seen mark (TV Time only stores the latest per show). */
function watchedKeys(state: ShowState, allKeys: string[]): Set<string> {
  const watched = new Set<string>(state.explicit);
  if (state.latest) {
    for (const k of allKeys) {
      const [s, e] = k.split(".").map(Number);
      if (!isAfter({ season: s, episode: e }, state.latest)) watched.add(k);
    }
  }
  return watched;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: tsx index.ts <export-dir> [--dry-run]");

  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false },
  });

  console.log(`Reading export from ${dir}${dryRun ? " (dry run)" : ""}`);
  const shows = loadShows(dir);
  const ratings = loadRatings(dir);
  console.log(`  ${shows.size} shows, ${ratings.size} ratings`);

  const report: Report = {
    followed: shows.size,
    matched: 0,
    unmatched: [],
    titles: 0,
    watchEvents: 0,
    ratings: 0,
    dryRun,
  };

  for (const state of shows.values()) {
    const tmdbId = await tvdbToTmdb(env.tmdbKey, state.tvdbId);
    if (!tmdbId) {
      report.unmatched.push({ tvdbId: state.tvdbId, name: state.name });
      continue;
    }
    report.matched++;
    if (dryRun) continue;

    const { titleId, episodeIds } = await upsertMetadata(admin, env.tmdbKey, tmdbId);
    report.titles++;

    await admin
      .from("library_entries")
      .upsert(
        { user_id: env.targetUserId, title_id: titleId, followed: true },
        { onConflict: "user_id,title_id" },
      );

    const watched = watchedKeys(state, [...episodeIds.keys()]);
    const events = [...watched]
      .map((k) => episodeIds.get(k))
      .filter((id): id is string => Boolean(id))
      .map((episode_id) => ({
        user_id: env.targetUserId,
        episode_id,
        source: "tvtime_import",
      }));
    if (events.length) {
      await admin.from("watch_events").upsert(events, { onConflict: "user_id,episode_id" });
      report.watchEvents += events.length;
    }

    const rating = ratings.get(state.tvdbId);
    if (rating) {
      await admin
        .from("ratings")
        .upsert(
          { user_id: env.targetUserId, title_id: titleId, score: rating.score },
          { onConflict: "user_id,title_id" },
        );
      report.ratings++;
    }
  }

  const reportPath = join(dir, "import-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n── Summary ─────────────────────────");
  console.log(`  followed shows : ${report.followed}`);
  console.log(`  matched → TMDB : ${report.matched}`);
  console.log(`  unmatched      : ${report.unmatched.length}`);
  if (!dryRun) {
    console.log(`  titles cached  : ${report.titles}`);
    console.log(`  watch_events   : ${report.watchEvents}`);
    console.log(`  ratings        : ${report.ratings}`);
  }
  console.log(`  report         : ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
