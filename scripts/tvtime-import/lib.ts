/**
 * Runtime-neutral TV Time import core — shared by the Node CLI (index.ts) and
 * the `importer` edge function (P3-C4). No Node-only APIs: it takes the zip as
 * bytes, unzips with fflate, parses the CSVs, maps TheTVDB→TMDB and upserts the
 * metadata + user data through an injected Supabase client. See P0-C10 / DESIGN
 * for the export format.
 */

import { unzipSync, strFromU8 } from "fflate";

// Minimal shapes for the injected Supabase client (avoids a hard dep on the
// exact supabase-js version across runtimes).
export interface DbClient {
  from(table: string): Any;
}
// deno-lint-ignore no-explicit-any
type Any = any;

const TMDB = "https://api.themoviedb.org/3";
const AIR_TIME = "T21:00:00Z";

// Verified against the real export headers (2026-07).
const SOURCE = {
  file: "user_tv_show_data.csv",
  tvdbId: "tv_show_id",
  name: "tv_show_name",
  followed: "is_followed",
  favorite: "is_favorited",
  seen: "nb_episodes_seen",
} as const;

// Per-episode watch history. `nb_episodes_seen` above is TV Time's own cached
// aggregate and disagrees with the real history on ~1/3 of shows (verified
// against the 2026-07 export: counter sum 9196 vs 9449 actual distinct
// watches), so exact rows win and the counter is only a fallback.
const TRACKING = {
  file: "tracking-prod-records-v2.csv",
  key: "key",           // rows whose key starts with "watch-episode"
  tvdbId: "s_id",       // same TheTVDB series id as SOURCE.tvdbId
  season: "season_number",
  episode: "episode_number",
  watchedAt: "created_at", // "YYYY-MM-DD HH:MM:SS" (UTC, no zone suffix)
} as const;

export interface Show {
  tvdbId: string;
  name: string;
  followed: boolean;
  favorite: boolean;
  seen: number;
}

export interface EpisodeWatch {
  season: number;
  episode: number;
  watchedAt: string; // ISO
}

export interface ImportReport {
  shows: number;
  followed: number;
  matched: number;
  matchedFollowed: number;
  unmatched: { tvdbId: string; name: string }[];
  errors: { tvdbId: string; name: string; error: string }[];
  titles: number;
  watchEvents: number;
  /** watched (season, episode) pairs with no TMDB counterpart (numbering drift). */
  unmatchedEpisodes: number;
}

// ── CSV ───────────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function toRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const grid = parseCsv(text);
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (cells[i] ?? "").trim()));
    return rec;
  });
  return { headers, rows };
}

/** Unzip the export bytes into a { filename → text } map (top-level CSVs). */
export function unzipCsvs(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    const name = path.split("/").pop() ?? path;
    if (name.endsWith(".csv")) out[name] = strFromU8(data as Uint8Array);
  }
  return out;
}

export class NotATvTimeExport extends Error {}

/** Parse the follow + watch state. Throws NotATvTimeExport if the key file /
 *  columns are missing (so the caller can reject non-TV-Time zips clearly). */
export function parseShows(files: Record<string, string>): Show[] {
  const raw = files[SOURCE.file];
  if (!raw) throw new NotATvTimeExport(`${SOURCE.file} not found — is this a TV Time export?`);
  const { headers, rows } = toRecords(raw);
  for (const col of [SOURCE.tvdbId, SOURCE.followed, SOURCE.seen]) {
    if (!headers.includes(col)) throw new NotATvTimeExport(`${SOURCE.file} missing column ${col}`);
  }
  return rows
    .map((r) => ({
      tvdbId: r[SOURCE.tvdbId],
      name: r[SOURCE.name] ?? "",
      followed: r[SOURCE.followed] === "1",
      favorite: r[SOURCE.favorite] === "1",
      seen: Number(r[SOURCE.seen] || 0),
    }))
    .filter((s) => s.tvdbId && (s.followed || s.seen > 0));
}

/** TheTVDB ids of shows the user archived in TV Time (kept, but stopped
 *  watching). Read from the per-show `user-series` rows of the v2 tracking file;
 *  empty when absent. Maps to library_entries.stopped. */
export function parseArchived(files: Record<string, string>): Set<string> {
  const raw = files[TRACKING.file];
  if (!raw) return new Set();
  const { headers, rows } = toRecords(raw);
  if (!headers.includes("is_archived") || !headers.includes(TRACKING.tvdbId)) return new Set();
  const out = new Set<string>();
  for (const r of rows) {
    if (r[TRACKING.key]?.startsWith("user-series") && r.is_archived?.toLowerCase() === "true" && r[TRACKING.tvdbId]) {
      out.add(r[TRACKING.tvdbId]);
    }
  }
  return out;
}

/** Parse the exact per-episode watch history: TheTVDB show id → deduped
 *  (season, episode, first-watched-at) list. Specials (season 0) excluded, like
 *  everywhere else. Returns an empty map when the tracking file is absent or
 *  has an unexpected shape (older exports) — callers then fall back to the
 *  per-show counter. */
export function parseWatches(files: Record<string, string>): Map<string, EpisodeWatch[]> {
  const raw = files[TRACKING.file];
  if (!raw) return new Map();
  const { headers, rows } = toRecords(raw);
  for (const col of [TRACKING.key, TRACKING.tvdbId, TRACKING.season, TRACKING.episode, TRACKING.watchedAt]) {
    if (!headers.includes(col)) return new Map();
  }
  const byShow = new Map<string, Map<string, EpisodeWatch>>();
  for (const r of rows) {
    if (!r[TRACKING.key]?.startsWith("watch-episode")) continue;
    const tvdbId = r[TRACKING.tvdbId];
    const season = Number(r[TRACKING.season]);
    const episode = Number(r[TRACKING.episode]);
    if (!tvdbId || !Number.isInteger(season) || !Number.isInteger(episode) || season <= 0 || episode <= 0) continue;
    const stamp = r[TRACKING.watchedAt];
    const watchedAt = stamp ? `${stamp.replace(" ", "T")}Z` : new Date().toISOString();
    const per = byShow.get(tvdbId) ?? new Map<string, EpisodeWatch>();
    const key = `${season}:${episode}`;
    const prev = per.get(key);
    if (!prev || watchedAt < prev.watchedAt) per.set(key, { season, episode, watchedAt }); // keep first watch; rewatches collapse
    byShow.set(tvdbId, per);
  }
  return new Map([...byShow].map(([id, per]) => [id, [...per.values()]]));
}

// ── TMDB + upserts ──────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
const tmdbFetch = (key: string, path: string): Promise<Json> =>
  fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`).then((r) => r.json() as Promise<Json>);

export async function tvdbToTmdb(key: string, tvdbId: string): Promise<number | null> {
  const data = await tmdbFetch(key, `/find/${tvdbId}?external_source=tvdb_id`);
  const results = (data.tv_results as Json[] | undefined) ?? [];
  return results[0] ? (results[0].id as number) : null;
}

const airDatetime = (d?: string | null) => (d ? `${d}${AIR_TIME}` : null);

async function upsertTitle(admin: DbClient, d: Json): Promise<string> {
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
        genres: ((d.genres as Json[] | undefined) ?? []).map((g) => g.name as string),
        network: ((d.networks as Json[] | undefined) ?? [])[0]?.name ?? null,
        episode_run_time: (d.episode_run_time as number[] | undefined)?.[0] ?? null,
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

/** Upsert one season + its episodes; returns the saved episode rows keyed for
 *  both ordered-id (legacy fallback) and (season:episode) → id (exact) use. */
async function importSeason(
  admin: DbClient,
  tmdbKey: string,
  tmdbId: number,
  titleId: string,
  s: Json,
): Promise<{ episodeIds: string[]; byPair: Map<string, string> }> {
  const { data: season, error: se } = await admin
    .from("seasons")
    .upsert(
      {
        title_id: titleId,
        tmdb_id: (s.id as number) ?? null,
        number: s.season_number,
        name: (s.name as string) ?? null,
        episode_count: (s.episode_count as number) ?? null,
        air_date: (s.air_date as string) || null,
      },
      { onConflict: "title_id,number" },
    )
    .select("id")
    .single();
  if (se || !season) throw new Error(`season upsert: ${se?.message}`);
  const sd = await tmdbFetch(tmdbKey, `/tv/${tmdbId}/season/${s.season_number}`);
  const eps = ((sd.episodes as Json[] | undefined) ?? [])
    .sort((a, b) => (a.episode_number as number) - (b.episode_number as number))
    .map((e) => ({
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
  const episodeIds: string[] = [];
  const byPair = new Map<string, string>();
  if (eps.length) {
    const { data: saved, error: ee } = await admin
      .from("episodes")
      .upsert(eps, { onConflict: "title_id,season_number,episode_number" })
      .select("id, episode_number");
    if (ee) throw new Error(`episodes upsert: ${ee.message}`);
    const byNum = new Map((saved ?? []).map((r: Any) => [r.episode_number, r.id]));
    for (const e of eps) {
      const id = byNum.get(e.episode_number);
      if (id) {
        episodeIds.push(id as string);
        byPair.set(`${e.season_number}:${e.episode_number}`, id as string);
      }
    }
  }
  return { episodeIds, byPair };
}

/** Import one show for one user. With exact per-episode `watches`, every season
 *  is cached (correct aired counts) and exactly those (season, episode) pairs
 *  are marked, stamped with the real first-watch date. Without them, fall back
 *  to marking the first `seen` episodes in order (the pre-2026-07 behavior). */
export async function importShow(
  admin: DbClient,
  tmdbKey: string,
  userId: string,
  show: Show,
  watches?: EpisodeWatch[],
  stopped = false,
): Promise<{ matched: boolean; watchEvents: number; unmatchedEpisodes: number }> {
  const tmdbId = await tvdbToTmdb(tmdbKey, show.tvdbId);
  if (!tmdbId) return { matched: false, watchEvents: 0, unmatchedEpisodes: 0 };

  const detail = await tmdbFetch(tmdbKey, `/tv/${tmdbId}`);
  const titleId = await upsertTitle(admin, detail);

  await admin.from("library_entries").upsert(
    { user_id: userId, title_id: titleId, followed: show.followed, favorite: show.favorite, stopped },
    { onConflict: "user_id,title_id" },
  );

  const exact = (watches?.length ?? 0) > 0;
  let watchEvents = 0;
  let unmatchedEpisodes = 0;
  if (exact || show.seen > 0) {
    const seasons = ((detail.seasons as Json[] | undefined) ?? [])
      .filter((s) => (s.season_number as number) > 0)
      .sort((a, b) => (a.season_number as number) - (b.season_number as number));
    const episodeIds: string[] = [];
    const byPair = new Map<string, string>();
    for (const s of seasons) {
      // legacy mode stops once enough episodes are cached; exact mode caches
      // every season so aired counts (and thus progress) are right.
      if (!exact && episodeIds.length >= show.seen) break;
      const saved = await importSeason(admin, tmdbKey, tmdbId, titleId, s);
      episodeIds.push(...saved.episodeIds);
      for (const [k, v] of saved.byPair) byPair.set(k, v);
    }

    let rows: { user_id: string; episode_id: string; watched_at?: string; source: string }[];
    if (exact) {
      rows = [];
      for (const w of watches!) {
        const id = byPair.get(`${w.season}:${w.episode}`);
        if (id) rows.push({ user_id: userId, episode_id: id, watched_at: w.watchedAt, source: "tvtime_import" });
        else unmatchedEpisodes++; // TVDB↔TMDB numbering drift; skipped, reported
      }
    } else {
      rows = episodeIds
        .slice(0, show.seen)
        .map((episode_id) => ({ user_id: userId, episode_id, source: "tvtime_import" }));
    }
    if (rows.length) {
      const { error } = await admin
        .from("watch_events")
        .upsert(rows, { onConflict: "user_id,episode_id" });
      if (error) throw new Error(`watch_events upsert: ${error.message}`);
      watchEvents = rows.length;
    }
  }
  return { matched: true, watchEvents, unmatchedEpisodes };
}

/** Full import for one user, from parsed shows (+ optional exact per-episode
 *  watches from parseWatches, keyed by TheTVDB id). onProgress fires per show. */
export async function runImport(
  admin: DbClient,
  tmdbKey: string,
  userId: string,
  shows: Show[],
  watchesByShow?: Map<string, EpisodeWatch[]>,
  archivedIds?: Set<string>,
  onProgress?: (done: number, report: ImportReport) => void,
): Promise<ImportReport> {
  const report: ImportReport = {
    shows: shows.length,
    followed: shows.filter((s) => s.followed).length,
    matched: 0,
    matchedFollowed: 0,
    unmatched: [],
    errors: [],
    titles: 0,
    watchEvents: 0,
    unmatchedEpisodes: 0,
  };
  let done = 0;
  for (const show of shows) {
    try {
      const { matched, watchEvents, unmatchedEpisodes } = await importShow(
        admin,
        tmdbKey,
        userId,
        show,
        watchesByShow?.get(show.tvdbId),
        archivedIds?.has(show.tvdbId) ?? false,
      );
      if (matched) {
        report.matched++;
        report.titles++;
        report.watchEvents += watchEvents;
        report.unmatchedEpisodes += unmatchedEpisodes;
        if (show.followed) report.matchedFollowed++;
      } else {
        report.unmatched.push({ tvdbId: show.tvdbId, name: show.name });
      }
    } catch (err) {
      report.errors.push({ tvdbId: show.tvdbId, name: show.name, error: (err as Error).message });
    }
    done++;
    onProgress?.(done, report);
  }
  return report;
}
