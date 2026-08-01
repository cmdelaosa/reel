/**
 * IMDb ratings importer — official datasets, no scraping.
 *
 * The ONLY writer of imdb_rating / imdb_votes. OMDb used to fill them nightly and
 * was removed: besides the gaps below it is years out of date (it still serves
 * "Ozymandias" as 10.0 from 251,146 votes where IMDb publishes 9.5 from 504,738),
 * so the nightly stale source kept overwriting this fresher one.
 *
 * WHY THIS EXISTS
 * OMDb (our live IMDb bridge) is missing the rating field for a large minority
 * of episodes: 6957 of them sat inside otherwise-rated seasons, and asking OMDb
 * for those episodes directly still returns "N/A" while reporting their vote
 * count (Breaking Bad's "Crawl Space": 54650 votes, no rating). The gap is in
 * OMDb's copy, not in IMDb — IMDb publishes the ratings itself, for free, daily:
 *
 *   https://datasets.imdbws.com/title.ratings.tsv.gz   (~8 MB)   tconst → rating, votes
 *   https://datasets.imdbws.com/title.episode.tsv.gz   (~52 MB)  tconst → parent, season, episode
 *
 * So we take them from the source instead. No proxies, no scraping, no ToS
 * problem — and `numVotes` comes along, which is what lets us ignore ratings
 * that are too young to mean anything.
 *
 * LICENCE: IMDb publishes these datasets for PERSONAL AND NON-COMMERCIAL use.
 * Reel is a private, invite-only app, which fits — but this importer would have
 * to go if that ever changes.
 *
 * WHAT IT DOES
 *   1. Reads our titles that carry an imdb_id — every cached show, not just the
 *      followed ones, since episode-refresh?backfillImdbIds=1 resolves the id for
 *      the whole cache. A title without an imdb_id is invisible here, which is
 *      exactly why shows nobody follows used to have no episode graph.
 *   2. Reads our episodes, so it only ever UPDATES rows we already have — it
 *      must never invent episode rows — and so it knows their air dates.
 *   3. Streams title.episode.tsv.gz, keeping only episodes of our shows.
 *   4. Streams title.ratings.tsv.gz, picking up those episodes' ratings plus the
 *      show-level ones.
 *   5. Drops anything below the vote/age floors, then upserts.
 *
 * RUN
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx index.ts [--dry-run]
 *
 * TUNING (env)
 *   MIN_VOTES      default 20  — below this a rating is noise
 *   MIN_AGE_DAYS   default 7   — skip episodes that aired more recently; a
 *                                day-old episode's score swings for a week
 *   DRY_RUN=1 / --dry-run      — report, write nothing
 */

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const EPISODES_URL = "https://datasets.imdbws.com/title.episode.tsv.gz";

const MIN_VOTES = Number(process.env.MIN_VOTES ?? 20);
const MIN_AGE_DAYS = Number(process.env.MIN_AGE_DAYS ?? 7);
const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");
const PAGE = 1000;
const CHUNK = 500;

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
}

/** Stream a gzipped TSV line by line, without ever holding it in memory. */
async function* tsvLines(url: string): AsyncGenerator<string[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const stream = Readable.fromWeb(res.body as never).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; } // header
    yield line.split("\t");
  }
}

/** Every row of a table, paged past PostgREST's 1000-row cap. */
async function all<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  tweak: (q: never) => never = (q) => q,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    q = tweak(q as never) as never;
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const started = Date.now();

  // ---- 1. our shows, keyed by their IMDb id -------------------------------
  const titles = await all<{ id: string; imdb_id: string | null }>(admin, "titles", "id, imdb_id");
  const titleByImdb = new Map<string, string>();
  for (const t of titles) if (t.imdb_id) titleByImdb.set(t.imdb_id, t.id);
  console.log(`titles with an imdb_id: ${titleByImdb.size}`);
  if (!titleByImdb.size) return;

  // ---- 2. our episodes: the only rows we may touch, plus their air dates ---
  const episodes = await all<{
    id: string; title_id: string; season_number: number; episode_number: number;
    air_datetime: string | null; imdb_rating: number | null; imdb_votes: number | null;
  }>(admin, "episodes", "id, title_id, season_number, episode_number, air_datetime, imdb_rating, imdb_votes");
  const ourEpisodes = new Map<string, (typeof episodes)[number]>();
  for (const e of episodes) ourEpisodes.set(`${e.title_id}|${e.season_number}|${e.episode_number}`, e);
  console.log(`episodes in our cache: ${ourEpisodes.size}`);

  // ---- 3. IMDb's episode index, filtered to our shows ----------------------
  // tconst → the row of ours it belongs to. Only our shows' episodes are kept,
  // so the ~8.5M-row file never materialises.
  const wanted = new Map<string, (typeof episodes)[number]>();
  let scanned = 0;
  for await (const [tconst, parent, season, episode] of tsvLines(EPISODES_URL)) {
    scanned++;
    const titleId = titleByImdb.get(parent);
    if (!titleId) continue;
    const s = Number(season), e = Number(episode);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s <= 0) continue; // \N, specials
    const ours = ourEpisodes.get(`${titleId}|${s}|${e}`);
    if (ours) wanted.set(tconst, ours);
  }
  console.log(`title.episode rows scanned: ${scanned.toLocaleString()} → ${wanted.size} of ours matched`);

  // ---- 4. ratings for those episodes, and for the shows themselves ---------
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 86_400_000).toISOString();
  const epRows: Record<string, unknown>[] = [];
  const showRows: Record<string, unknown>[] = [];
  let tooFew = 0, tooYoung = 0, unchanged = 0;

  for await (const [tconst, rating, votes] of tsvLines(RATINGS_URL)) {
    const score = Number(rating), n = Number(votes);
    if (!Number.isFinite(score)) continue;

    const showId = titleByImdb.get(tconst);
    if (showId) {
      // Shows accumulate votes for years; only the episode floors matter.
      showRows.push({ id: showId, imdb_rating: score, imdb_votes: Number.isFinite(n) ? n : null });
      continue;
    }

    const ours = wanted.get(tconst);
    if (!ours) continue;
    if (!Number.isFinite(n) || n < MIN_VOTES) { tooFew++; continue; }
    // A rating a few days old still swings; let it settle before storing it.
    if (ours.air_datetime && ours.air_datetime > cutoff) { tooYoung++; continue; }
    // Skip only rows that are ALREADY complete. Matching on the rating alone
    // stranded 11258 episodes that OMDb had filled without a vote count — their
    // score matched, so the row was never touched again and its votes stayed
    // null forever.
    if (ours.imdb_rating != null && ours.imdb_votes != null && Math.abs(ours.imdb_rating - score) < 0.05) {
      unchanged++;
      continue;
    }
    epRows.push({
      title_id: ours.title_id,
      season_number: ours.season_number,
      episode_number: ours.episode_number,
      imdb_rating: score,
      imdb_votes: n,
      imdb_id: tconst,
    });
  }

  console.log(
    `episodes to write: ${epRows.length} | shows: ${showRows.length} | ` +
      `skipped — under ${MIN_VOTES} votes: ${tooFew}, aired < ${MIN_AGE_DAYS}d ago: ${tooYoung}, unchanged: ${unchanged}`,
  );

  if (DRY_RUN) {
    console.log("dry run — nothing written");
    return;
  }

  // ---- 5. write ------------------------------------------------------------
  // Episodes upsert on the natural key; every row here was matched against a row
  // we already hold, so this can only ever update.
  for (let i = 0; i < epRows.length; i += CHUNK) {
    const { error } = await admin
      .from("episodes")
      .upsert(epRows.slice(i, i + CHUNK), { onConflict: "title_id,season_number,episode_number" });
    if (error) throw new Error(`episodes upsert: ${error.message}`);
  }
  // Shows go one UPDATE at a time, NOT an upsert. An upsert sends an INSERT …
  // ON CONFLICT, and Postgres checks the proposed row's NOT NULL constraints
  // before it ever gets to the conflict clause — so a partial row of
  // {id, imdb_rating, imdb_votes} fails on titles.tmdb_id/name every time.
  // (Episodes above are safe because their payload carries the whole natural
  // key, which is all the NOT NULLs that table has.)
  for (const row of showRows) {
    const { id, ...patch } = row as { id: string; [k: string]: unknown };
    const { error } = await admin.from("titles").update(patch).eq("id", id);
    if (error) throw new Error(`titles update: ${error.message}`);
  }

  // Same bookkeeping the edge crons write, so this job is visible in one place.
  await admin.from("job_runs").insert({
    job: "imdb-dataset-import",
    started_at: new Date(started).toISOString(),
    finished_at: new Date().toISOString(),
    ok: true,
    summary: {
      shows: showRows.length,
      episodes: epRows.length,
      skippedFewVotes: tooFew,
      skippedTooYoung: tooYoung,
      unchanged,
      minVotes: MIN_VOTES,
      minAgeDays: MIN_AGE_DAYS,
    },
  });
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
