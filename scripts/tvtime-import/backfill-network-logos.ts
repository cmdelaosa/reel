/**
 * Backfill public.network_logos for an already-imported library, so existing
 * shows render their official TMDB brand logo instead of a two-letter monogram
 * (0023_network_logos.sql). Going forward the tmdb-proxy / episode-refresh /
 * importer fill this cache on their own; this is the one-shot for what's already
 * there.
 *
 * It reads the DISTINCT `network` names in `titles`, fetches ONE representative
 * show per network from TMDB (so ~N_networks calls, not N_titles), and upserts
 * every network it sees {name → logo_path}.
 *
 * RUN:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TMDB_API_KEY=... \
 *   npx tsx backfill-network-logos.ts
 */

import { createClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w92";

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
  };
}

// deno-lint-ignore no-explicit-any
type Any = any;
const tmdbFetch = (key: string, path: string): Promise<Any> =>
  fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`).then((r) => {
    if (!r.ok) throw new Error(`TMDB ${path}: ${r.status}`);
    return r.json();
  });

// ── logo brightness ─────────────────────────────────────────────────────────
// Decide whether a brand logo is "dark" (dark-on-transparent, needs a light
// tile) by decoding the w92 PNG and checking whether it has ANY light pixels: a
// pure-black wordmark (HBO, FX, AMC) has none and vanishes on a dark tile; a
// white/colored logo (STARZ, Hulu, Peacock) has plenty and reads fine.
// Returns null when the image can't be decoded.
function isDarkLogo(buf: Buffer): boolean | null {
  let png;
  try { png = PNG.sync.read(buf); } catch { return null; }
  const d = png.data; // RGBA, normalised by pngjs (handles interlacing, palettes)
  let opaque = 0, light = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    opaque++;
    if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 140) light++;
  }
  if (!opaque) return null;
  return light / opaque < 0.05; // < 5% light pixels → dark logo → needs light tile
}

async function main() {
  const env = readEnv();
  const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });

  const { data: rows, error } = await admin
    .from("titles")
    .select("network, tmdb_id")
    .not("network", "is", null);
  if (error) throw new Error(`titles read: ${error.message}`);

  // one representative tmdb_id per distinct network name
  const repByNetwork = new Map<string, number>();
  for (const r of (rows ?? []) as { network: string; tmdb_id: number }[]) {
    if (!repByNetwork.has(r.network)) repByNetwork.set(r.network, r.tmdb_id);
  }
  console.log(`${repByNetwork.size} distinct networks across ${rows?.length ?? 0} titles`);

  const logos = new Map<string, string | null>(); // name → logo_path
  let fetched = 0;
  for (const [network, tmdbId] of repByNetwork) {
    try {
      const d = await tmdbFetch(env.tmdbKey, `/tv/${tmdbId}`);
      for (const n of (d.networks ?? []) as Any[]) {
        if (n?.name) logos.set(n.name, n.logo_path ?? null);
      }
      fetched++;
      if (fetched % 10 === 0) console.log(`  ${fetched}/${repByNetwork.size} fetched`);
    } catch (err) {
      console.error(`  ${network} (tmdb ${tmdbId}): ${String(err)}`);
    }
  }

  // Measure each logo's brightness so the client can pick a light vs dark tile.
  const upserts: { name: string; logo_path: string | null; logo_dark: boolean | null; updated_at: string }[] = [];
  let measured = 0;
  for (const [name, logo_path] of logos) {
    let logo_dark: boolean | null = null;
    if (logo_path && logo_path.endsWith(".png")) {
      try {
        const res = await fetch(`${IMG}${logo_path}`);
        logo_dark = isDarkLogo(Buffer.from(await res.arrayBuffer()));
        if (logo_dark !== null) measured++;
      } catch { /* leave null — client falls back to a dark tile */ }
    }
    upserts.push({ name, logo_path, logo_dark, updated_at: new Date().toISOString() });
  }

  const { error: ue } = await admin.from("network_logos").upsert(upserts, { onConflict: "name" });
  if (ue) throw new Error(`network_logos upsert: ${ue.message}`);

  const withArt = upserts.filter((u) => u.logo_path).length;
  const dark = upserts.filter((u) => u.logo_dark === true).length;
  console.log(`\n── Done ─────────────────────────`);
  console.log(`  networks cached : ${upserts.length}`);
  console.log(`  with logo art   : ${withArt}`);
  console.log(`  brightness meas.: ${measured}`);
  console.log(`  dark logos      : ${dark} (light tile)`);
  console.log(`  light logos     : ${measured - dark} (dark tile)`);
  console.log(`  no TMDB logo    : ${upserts.length - withArt}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
