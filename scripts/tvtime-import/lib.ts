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

export interface Show {
  tvdbId: string;
  name: string;
  followed: boolean;
  favorite: boolean;
  seen: number;
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

/** Import one show for one user. Returns matched + watch-event count. */
export async function importShow(
  admin: DbClient,
  tmdbKey: string,
  userId: string,
  show: Show,
): Promise<{ matched: boolean; watchEvents: number }> {
  const tmdbId = await tvdbToTmdb(tmdbKey, show.tvdbId);
  if (!tmdbId) return { matched: false, watchEvents: 0 };

  const detail = await tmdbFetch(tmdbKey, `/tv/${tmdbId}`);
  const titleId = await upsertTitle(admin, detail);

  await admin.from("library_entries").upsert(
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
      if (eps.length) {
        const { data: saved, error: ee } = await admin
          .from("episodes")
          .upsert(eps, { onConflict: "title_id,season_number,episode_number" })
          .select("id, episode_number");
        if (ee) throw new Error(`episodes upsert: ${ee.message}`);
        const byNum = new Map((saved ?? []).map((r: Any) => [r.episode_number, r.id]));
        for (const e of eps) {
          const id = byNum.get(e.episode_number);
          if (id) episodeIds.push(id as string);
        }
      }
    }
    const watched = episodeIds.slice(0, show.seen);
    if (watched.length) {
      const { error } = await admin
        .from("watch_events")
        .upsert(
          watched.map((episode_id) => ({ user_id: userId, episode_id, source: "tvtime_import" })),
          { onConflict: "user_id,episode_id" },
        );
      if (error) throw new Error(`watch_events upsert: ${error.message}`);
      watchEvents = watched.length;
    }
  }
  return { matched: true, watchEvents };
}

/** Full import for one user, from parsed shows. onProgress fires per show. */
export async function runImport(
  admin: DbClient,
  tmdbKey: string,
  userId: string,
  shows: Show[],
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
  };
  let done = 0;
  for (const show of shows) {
    try {
      const { matched, watchEvents } = await importShow(admin, tmdbKey, userId, show);
      if (matched) {
        report.matched++;
        report.titles++;
        report.watchEvents += watchEvents;
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
