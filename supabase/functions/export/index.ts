// export — download-my-data (P3-C6). Streams a zip of the caller's data:
// profile.json, library.json, watch_events.csv, ratings.csv. Uses a
// user-scoped client so RLS returns only the caller's rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zipSync, strToU8 } from "fflate";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Any = any;

function csv(rows: Record<string, Any>[], columns: string[]): string {
  const esc = (v: Any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });

  // Page past PostgREST's max_rows (1000) so big watch histories export whole.
  const all = async (table: string, columns: string): Promise<Any[]> => {
    const out: Any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select(columns).range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  const [{ data: profile }, library, watch, ratings] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).single(),
    all("library_entries", "title_id, followed, favorite, notify, added_at, titles(tmdb_id, name)"),
    all("watch_events", "watched_at, source, episodes(season_number, episode_number, titles(tmdb_id, name))"),
    all("ratings", "score, created_at, updated_at, titles(tmdb_id, name)"),
  ]);

  const watchRows = watch.map((w: Any) => ({
    show: w.episodes?.titles?.name ?? "",
    tmdb_id: w.episodes?.titles?.tmdb_id ?? "",
    season: w.episodes?.season_number ?? "",
    episode: w.episodes?.episode_number ?? "",
    watched_at: w.watched_at,
    source: w.source,
  }));
  const ratingRows = ratings.map((r: Any) => ({
    show: r.titles?.name ?? "",
    tmdb_id: r.titles?.tmdb_id ?? "",
    score: r.score,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const files: Record<string, Uint8Array> = {
    "profile.json": strToU8(JSON.stringify(profile ?? {}, null, 2)),
    "library.json": strToU8(JSON.stringify(library, null, 2)),
    "watch_events.csv": strToU8(csv(watchRows, ["show", "tmdb_id", "season", "episode", "watched_at", "source"])),
    "ratings.csv": strToU8(csv(ratingRows, ["show", "tmdb_id", "score", "created_at", "updated_at"])),
  };

  const zipped = zipSync(files, { level: 6 });
  // copy into a standalone ArrayBuffer for the Response body
  const body = new Uint8Array(zipped);

  return new Response(body, {
    headers: {
      ...cors,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="reel-export.zip"`,
    },
  });
});
