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
import { parseShows, runImport, tvdbToTmdb, type Show } from "./lib.ts";

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
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: tsx index.ts <export-dir> [--dry-run]");

  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const shows = parseShows(readCsvDir(dir));
  console.log(`${dir}${dryRun ? " (dry run)" : ""}: ${shows.length} shows (${shows.filter((s: Show) => s.followed).length} followed). Ratings skipped by design.`);

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

  const report = await runImport(admin, env.tmdbKey, env.targetUserId, shows, (done, r) => {
    if (done % 25 === 0) console.log(`  ${done}/${shows.length} — matched ${r.matched}, watch_events ${r.watchEvents}`);
  });
  writeFileSync(join(dir, "import-report.json"), JSON.stringify(report, null, 2));
  console.log("\n── Summary ─────────────────────────");
  console.log(`  matched → TMDB : ${report.matched} (${report.matchedFollowed} followed)`);
  console.log(`  unmatched      : ${report.unmatched.length}`);
  console.log(`  errors         : ${report.errors.length}`);
  console.log(`  titles cached  : ${report.titles}`);
  console.log(`  watch_events   : ${report.watchEvents}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
