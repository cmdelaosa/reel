// tmdb-proxy — Deno edge function (P0-C9).
//
// Routes (under /functions/v1/tmdb-proxy):
//   GET /search?q=                 → { results: TitleRow[] }
//   GET /title/:tmdbId             → { title: TitleRow, seasons: SeasonRow[] }
//   GET /title/:tmdbId/season/:n   → { season: SeasonRow, episodes: EpisodeRow[] }
//
// Each call upserts into the metadata cache with the service-role key and
// returns the cached rows — the client never sees raw TMDB payloads. A valid
// *user* JWT is required (the anon key alone is rejected). The response shape is
// mirrored (minimally, no cross-runtime import) by app/src/lib/schemas.ts.
//
// air_datetime placeholder: TMDB gives an air_date (day) but no time, so we
// stamp 21:00 UTC. Refined later if we add a real time source.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TMDB = "https://api.themoviedb.org/3";
const AIR_TIME = "T21:00:00Z"; // UTC placeholder appended to TMDB air_date

// TMDB TV genre ids → names. Search results carry only ids; details carry names.
const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
  10766: "Soap", 10767: "Talk", 10768: "War & Politics", 37: "Western",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const airDatetime = (airDate?: string | null) =>
  airDate ? `${airDate}${AIR_TIME}` : null;

// deno-lint-ignore no-explicit-any
type Any = any;

function titleRow(d: Any) {
  return {
    tmdb_id: d.id,
    kind: "tv",
    name: d.name ?? d.original_name ?? "Untitled",
    overview: d.overview ?? null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    first_air_date: d.first_air_date || null,
    status: d.status ?? null,
    genres: (d.genres ?? []).map((g: Any) => g.name),
    network: d.networks?.[0]?.name ?? null,
    episode_run_time: d.episode_run_time?.[0] ?? null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    last_refreshed_at: new Date().toISOString(),
  };
}

// Search results are partial: only genre_ids (mapped) and no network/status/
// runtime — so we omit those columns to avoid clobbering richer detail rows on
// conflict (PostgREST upsert only updates the columns present in the payload).
function searchRow(r: Any) {
  return {
    tmdb_id: r.id,
    kind: "tv",
    name: r.name ?? r.original_name ?? "Untitled",
    overview: r.overview ?? null,
    poster_path: r.poster_path ?? null,
    backdrop_path: r.backdrop_path ?? null,
    first_air_date: r.first_air_date || null,
    genres: (r.genre_ids ?? []).map((id: number) => TV_GENRES[id]).filter(Boolean),
    vote_average: r.vote_average ?? null,
    popularity: r.popularity ?? null,
    last_refreshed_at: new Date().toISOString(),
  };
}

const seasonRow = (titleId: string, s: Any) => ({
  title_id: titleId,
  tmdb_id: s.id ?? null,
  number: s.season_number,
  name: s.name ?? null,
  episode_count: s.episode_count ?? null,
  air_date: s.air_date || null,
});

const episodeRow = (titleId: string, seasonId: string, e: Any) => ({
  title_id: titleId,
  season_id: seasonId,
  tmdb_id: e.id ?? null,
  season_number: e.season_number,
  episode_number: e.episode_number,
  name: e.name ?? null,
  overview: e.overview ?? null,
  runtime: e.runtime ?? null,
  air_datetime: airDatetime(e.air_date),
});

async function upsertReturning(admin: SupabaseClient, table: string, rows: Any, onConflict: string) {
  const { data, error } = await admin.from(table).upsert(rows, { onConflict }).select();
  if (error) throw new Error(`${table} upsert: ${error.message}`);
  return data ?? [];
}

async function ensureTitle(admin: SupabaseClient, apiKey: string, tmdbId: number) {
  const d = await fetchTmdb(apiKey, `/tv/${tmdbId}`);
  const [row] = await upsertReturning(admin, "titles", titleRow(d), "tmdb_id");
  return { detail: d, title: row };
}

const fetchTmdb = (apiKey: string, p: string) =>
  fetch(`${TMDB}${p}${p.includes("?") ? "&" : "?"}api_key=${apiKey}`).then((r) => r.json());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // --- auth: require a real signed-in user (anon key alone → 401) ---
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("TMDB_API_KEY");
  if (!apiKey) return json({ error: "TMDB_API_KEY not configured" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/tmdb-proxy/, "").replace(/\/+$/, "");

  try {
    // GET /search?q=
    if (path === "/search") {
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ results: [] });
      const data = await fetchTmdb(apiKey, `/search/tv?query=${encodeURIComponent(q)}&include_adult=false`);
      const results: Any[] = data.results ?? [];
      if (results.length === 0) return json({ results: [] });
      const saved = await upsertReturning(admin, "titles", results.map(searchRow), "tmdb_id");
      // preserve TMDB relevance order
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: results.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /title/:id
    const mTitle = path.match(/^\/title\/(\d+)$/);
    if (mTitle) {
      const { detail, title } = await ensureTitle(admin, apiKey, Number(mTitle[1]));
      const seasons = (detail.seasons ?? []).length
        ? await upsertReturning(admin, "seasons", detail.seasons.map((s: Any) => seasonRow(title.id, s)), "title_id,number")
        : [];
      return json({ title, seasons });
    }

    // GET /title/:id/season/:n
    const mSeason = path.match(/^\/title\/(\d+)\/season\/(\d+)$/);
    if (mSeason) {
      const { title } = await ensureTitle(admin, apiKey, Number(mSeason[1]));
      const s = await fetchTmdb(apiKey, `/tv/${mSeason[1]}/season/${mSeason[2]}`);
      const [season] = await upsertReturning(admin, "seasons", seasonRow(title.id, s), "title_id,number");
      const episodes = (s.episodes ?? []).length
        ? await upsertReturning(
            admin,
            "episodes",
            s.episodes.map((e: Any) => episodeRow(title.id, season.id, e)),
            "title_id,season_number,episode_number",
          )
        : [];
      return json({ season, episodes });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
});
