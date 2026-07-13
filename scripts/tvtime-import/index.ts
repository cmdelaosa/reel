/**
 * TV Time export → Supabase seed importer (P0-C10 CLI; core in ./lib.ts, shared
 * with the in-app importer edge function P3-C4).
 *
 * RUN (local `supabase start` or hosted):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TMDB_API_KEY=... \
 *   TARGET_USER_ID=<profiles.id> \
 *   npx tsx index.ts <path-to-export-dir> [--dry-run]
 *
 * The export dir holds the unzipped CSVs (keep it OUTSIDE the repo — it has a
 * live OAuth token + password hash; see DESIGN.md). Ratings are skipped by
 * design (see lib.ts / DESIGN).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseShows, parseWatches, parseArchived, parseFollowedAt, runImport, tvdbToTmdb, type Show } from "./lib.ts";

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

function readCsvDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".csv")) files[name] = readFileSync(join(dir, name), "utf8");
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const replace = args.includes("--replace");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: tsx index.ts <export-dir> [--dry-run] [--replace]");

  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const files = readCsvDir(dir);
  const shows = parseShows(files);
  const watches = parseWatches(files);
  const archived = parseArchived(files);
  const followed = parseFollowedAt(files);
  const exactTotal = [...watches.values()].reduce((n, w) => n + w.length, 0);
  console.log(
    `${dir}${dryRun ? " (dry run)" : ""}: ${shows.length} shows (${shows.filter((s: Show) => s.followed).length} followed), ` +
      `${exactTotal} exact episode watches across ${watches.size} shows${exactTotal ? "" : " — FALLING BACK to per-show counters"}. Ratings skipped by design.`,
  );

  if (dryRun) {
    let matched = 0, matchedFollowed = 0;
    const unmatched: string[] = [];
    let i = 0;
    for (const s of shows) {
      const id = await tvdbToTmdb(env.tmdbKey, s.tvdbId);
      if (id) { matched++; if (s.followed) matchedFollowed++; } else unmatched.push(s.name);
      if (++i % 25 === 0) console.log(`  ${i}/${shows.length} — matched ${matched}`);
    }
    console.log(`\nmatched ${matched}/${shows.length} (${matchedFollowed} followed), unmatched ${unmatched.length}`);
    return;
  }

  if (replace) {
    // wipe this user's previous import (e.g. counter-based first-N marks) so the
    // exact history fully replaces it; manual marks (other sources) are kept.
    const { error, count } = await admin
      .from("watch_events")
      .delete({ count: "exact" })
      .eq("user_id", env.targetUserId)
      .eq("source", "tvtime_import");
    if (error) throw new Error(`--replace delete failed: ${error.message}`);
    console.log(`--replace: deleted ${count ?? 0} previous tvtime_import watch_events`);
  }

  const report = await runImport(admin, env.tmdbKey, env.targetUserId, shows, watches, archived, followed, (done, r) => {
    if (done % 25 === 0) console.log(`  ${done}/${shows.length} — matched ${r.matched}, watch_events ${r.watchEvents}`);
  });
  writeFileSync(join(dir, "import-report.json"), JSON.stringify(report, null, 2));
  console.log("\n── Summary ─────────────────────────");
  console.log(`  matched → TMDB : ${report.matched} (${report.matchedFollowed} followed)`);
  console.log(`  unmatched      : ${report.unmatched.length}`);
  console.log(`  errors         : ${report.errors.length}`);
  console.log(`  titles cached  : ${report.titles}`);
  console.log(`  watch_events   : ${report.watchEvents}`);
  console.log(`  eps unmatched  : ${report.unmatchedEpisodes} (numbering drift)`);
  console.log(`  stopped shows  : ${archived.size} (TV Time archived)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
