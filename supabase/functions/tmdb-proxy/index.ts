// tmdb-proxy — Deno edge function (P0-C9).
//
// Routes (under /functions/v1/tmdb-proxy):
//   GET /search?q=                 → { results: TitleRow[] }
//   GET /trending                  → { results: TitleRow[] }
//   GET /popular-now               → { results: TitleRow[] }
//   GET /popular?from=&to=         → { results: TitleRow[] }
//   GET /collection/:slug          → { results: TitleRow[] }
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

// Content hidden from the *discovery* surfaces (trending + popular) only;
// search still finds any of it by name. TMDB's /discover can't express these
// exclusions (no without_language param; with_original_language is single-
// valued), so we post-filter the raw results:
//   • anime          — Animation genre + a Japanese/Chinese/Korean original
//                      language (keeps Western animation: Rick & Morty, Arcane…).
//   • soaps          — the Soap genre (10766), incl. telenovelas.
//   • reality        — the Reality genre (10764).
//   • indian/turkish — original language from the Indian subcontinent or Turkish,
//                      which dominate TMDB popularity but aren't of interest here.
const ANIMATION_GENRE = 16;
const HIDDEN_GENRES = new Set([10766, 10764]); // Soap, Reality
const ANIME_LANGS = new Set(["ja", "zh", "ko"]);
const HIDDEN_LANGS = new Set(["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "ur", "tr"]);
// deno-lint-ignore no-explicit-any
const isHidden = (r: any) => {
  const genres: number[] = r?.genre_ids ?? [];
  const lang: string = r?.original_language ?? "";
  if (genres.includes(ANIMATION_GENRE) && ANIME_LANGS.has(lang)) return true; // anime
  if (genres.some((g) => HIDDEN_GENRES.has(g))) return true; // soaps / reality
  if (HIDDEN_LANGS.has(lang)) return true; // indian / turkish
  return false;
};

// Curated-collection slugs → TMDB /discover/tv criteria. Mirrors the intent of
// the original 0020 seed (which capped each at 12 cached titles) but pulls live
// from the full TMDB catalog. The rating sorts need a high vote_count floor:
// with a low one, niche fan-voted titles outrank Breaking Bad.
const COLLECTION_QUERIES: Record<string, string> = {
  // best-reviewed of all time
  "critically-acclaimed": "sort_by=vote_average.desc&vote_count.gte=1000",
  // comedies, most popular first
  "bingeable-weekend": "with_genres=35&sort_by=popularity.desc&vote_count.gte=100",
  // sci-fi/fantasy or mystery, best-rated first
  "mind-benders": "with_genres=10765|9648&sort_by=vote_average.desc&vote_count.gte=1000",
  // top-rated dramas
  "award-winners": "with_genres=18&vote_average.gte=8&sort_by=vote_average.desc&vote_count.gte=1000",
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

// Cache each network's official TMDB logo_path keyed by its display name, so the
// client can render the brand image for any platform (not just the hard-coded
// few). Best-effort: a logo cache miss must never break title loading.
async function cacheNetworkLogos(admin: SupabaseClient, networks: Any) {
  const rows = ((networks ?? []) as Any[])
    .filter((n) => n?.name)
    .map((n) => ({ name: n.name as string, logo_path: n.logo_path ?? null, updated_at: new Date().toISOString() }));
  if (!rows.length) return;
  const { error } = await admin.from("network_logos").upsert(rows, { onConflict: "name" });
  if (error) console.error(`network_logos upsert: ${error.message}`);
}

async function ensureTitle(admin: SupabaseClient, apiKey: string, tmdbId: number) {
  const d = await fetchTmdb(apiKey, `/tv/${tmdbId}`);
  const [row] = await upsertReturning(admin, "titles", titleRow(d), "tmdb_id");
  await cacheNetworkLogos(admin, d.networks);
  return { detail: d, title: row };
}

const fetchTmdb = async (apiKey: string, p: string) => {
  const res = await fetch(`${TMDB}${p}${p.includes("?") ? "&" : "?"}api_key=${apiKey}`);
  if (!res.ok) throw new Error(`TMDB ${p}: ${res.status}`); // don't treat an error body as data
  return res.json();
};

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

    // GET /trending  (TMDB /trending/tv/week, cached 24h in trending_cache)
    if (path === "/trending") {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: fresh } = await admin
        .from("trending_cache")
        .select("tmdb_id, rank")
        .gte("cached_at", dayAgo)
        .order("rank");
      let ranked: { tmdb_id: number; rank: number }[] = fresh ?? [];
      if (ranked.length === 0) {
        // Pull a couple of pages: after hiding anime/soaps/reality/etc a single
        // 20-item page thins out, so we go wider and keep the top TREND_KEEP.
        const TREND_PAGES = 2;
        const TREND_KEEP = 24;
        const pages = await Promise.all(
          Array.from({ length: TREND_PAGES }, (_, i) =>
            fetchTmdb(apiKey, `/trending/tv/week?page=${i + 1}`)
          ),
        );
        // Dedupe across pages (trending repeats titles) before dropping hidden.
        const seen = new Set<number>();
        const results: Any[] = [];
        for (const r of pages.flatMap((d) => d.results ?? [])) {
          if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); results.push(r); }
        }
        results.length = Math.min(results.length, TREND_KEEP);
        if (results.length) {
          await upsertReturning(admin, "titles", results.map(searchRow), "tmdb_id");
          ranked = results.map((r, i) => ({ tmdb_id: r.id as number, rank: i + 1 }));
          // Upsert (not delete+insert) so two concurrent cold-cache refreshes
          // can't collide on the PK. Stale rows keep their old cached_at and are
          // filtered out by the 24h window above.
          const now = new Date().toISOString();
          await admin
            .from("trending_cache")
            .upsert(ranked.map((r) => ({ ...r, cached_at: now })), { onConflict: "tmdb_id" });
        }
      }
      if (ranked.length === 0) return json({ results: [] });
      const { data: rows } = await admin
        .from("titles")
        .select("*")
        .in("tmdb_id", ranked.map((r) => r.tmdb_id));
      const byTmdb = new Map((rows ?? []).map((r: Any) => [r.tmdb_id, r]));
      return json({ results: ranked.map((r) => byTmdb.get(r.tmdb_id)).filter(Boolean) });
    }

    // GET /popular-now  — shows with a *season premiere* (S1 or a new season)
    // in the last 90 days or the next 30, ranked by TMDB popularity. Raw
    // popularity.desc favours long-running syndicated shows (SVU, Grey's…);
    // gating on a premiere keeps the grid about things happening *now*.
    // Discover can't see season dates, so we detail-check the top candidates
    // and cache the resulting order 24h in popular_now_cache.
    if (path === "/popular-now") {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: fresh } = await admin
        .from("popular_now_cache")
        .select("tmdb_id, rank")
        .gte("cached_at", dayAgo)
        .order("rank");
      let ranked: { tmdb_id: number; rank: number }[] = fresh ?? [];
      if (ranked.length === 0) {
        const DAY = 24 * 3600 * 1000;
        const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
        const until = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
        const CANDIDATES = 80; // detail fetches per cold refresh
        const KEEP = 48;
        // Candidate pool: shows with episodes airing in the window, plus shows
        // *first* airing in it (covers upcoming S1s with nothing aired yet).
        const queries = [
          ...Array.from({ length: 4 }, (_, i) =>
            `/discover/tv?sort_by=popularity.desc&include_adult=false&air_date.gte=${since}&air_date.lte=${until}&page=${i + 1}`),
          ...Array.from({ length: 2 }, (_, i) =>
            `/discover/tv?sort_by=popularity.desc&include_adult=false&first_air_date.gte=${since}&first_air_date.lte=${until}&page=${i + 1}`),
        ];
        const pages = await Promise.all(queries.map((q) => fetchTmdb(apiKey, q)));
        const seen = new Set<number>();
        const candidates: Any[] = [];
        for (const r of pages.flatMap((d) => d.results ?? [])) {
          if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); candidates.push(r); }
        }
        candidates.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
        candidates.length = Math.min(candidates.length, CANDIDATES);
        // Detail-check in chunks (TMDB rate limit): keep shows with a real
        // season (not specials) premiering inside the window.
        const premiered: Any[] = [];
        const CHUNK = 20;
        for (let i = 0; i < candidates.length; i += CHUNK) {
          const details = await Promise.all(
            candidates.slice(i, i + CHUNK).map((c) => fetchTmdb(apiKey, `/tv/${c.id}`).catch(() => null)),
          );
          for (const d of details) {
            if (!d) continue;
            const hasPremiere = (d.seasons ?? []).some((s: Any) =>
              (s.season_number ?? 0) > 0 && s.air_date && s.air_date >= since && s.air_date <= until);
            if (hasPremiere) premiered.push(d);
          }
        }
        premiered.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
        premiered.length = Math.min(premiered.length, KEEP);
        if (premiered.length) {
          // We hold full details here, so upsert the rich row (network, status…).
          await upsertReturning(admin, "titles", premiered.map(titleRow), "tmdb_id");
          await cacheNetworkLogos(admin, premiered.flatMap((d: Any) => d.networks ?? []));
          ranked = premiered.map((d, i) => ({ tmdb_id: d.id as number, rank: i + 1 }));
          const now = new Date().toISOString();
          await admin
            .from("popular_now_cache")
            .upsert(ranked.map((r) => ({ ...r, cached_at: now })), { onConflict: "tmdb_id" });
        }
      }
      if (ranked.length === 0) return json({ results: [] });
      const { data: rows } = await admin
        .from("titles")
        .select("*")
        .in("tmdb_id", ranked.map((r) => r.tmdb_id));
      const byTmdb = new Map((rows ?? []).map((r: Any) => [r.tmdb_id, r]));
      return json({ results: ranked.map((r) => byTmdb.get(r.tmdb_id)).filter(Boolean) });
    }

    // GET /popular?from=YYYY&to=YYYY  (TMDB /discover/tv by popularity, with an
    // optional first-air-year range). Pulls a few pages so the grid has depth.
    if (path === "/popular") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const yearParams =
        (from ? `&first_air_date.gte=${from}-01-01` : "") +
        (to ? `&first_air_date.lte=${to}-12-31` : "");
      const PAGES = 5;
      const pages = await Promise.all(
        Array.from({ length: PAGES }, (_, i) =>
          fetchTmdb(apiKey, `/discover/tv?sort_by=popularity.desc&include_adult=false&page=${i + 1}${yearParams}`)
        ),
      );
      // Dedupe across pages before upserting — a repeated tmdb_id in one upsert
      // batch errors ("cannot affect row a second time").
      const seen = new Set<number>();
      const uniq: Any[] = [];
      for (const r of pages.flatMap((d) => d.results ?? [])) {
        if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); uniq.push(r); }
      }
      if (uniq.length === 0) return json({ results: [] });
      const saved = await upsertReturning(admin, "titles", uniq.map(searchRow), "tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: uniq.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /collection/:slug  (TMDB /discover/tv per curated-collection criteria;
    // several pages so each collection has real depth beyond the old 12-row seed)
    const mCollection = path.match(/^\/collection\/([a-z0-9-]+)$/);
    if (mCollection) {
      const query = COLLECTION_QUERIES[mCollection[1]];
      if (!query) return json({ error: "unknown collection" }, 404);
      // Deeper than /popular's 5: the hidden-content filter plus the client
      // dropping everything already followed/ignored eats a lot of rows here.
      const PAGES = 8;
      const pages = await Promise.all(
        Array.from({ length: PAGES }, (_, i) =>
          fetchTmdb(apiKey, `/discover/tv?include_adult=false&${query}&page=${i + 1}`)
        ),
      );
      const seen = new Set<number>();
      const uniq: Any[] = [];
      for (const r of pages.flatMap((d) => d.results ?? [])) {
        if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); uniq.push(r); }
      }
      if (uniq.length === 0) return json({ results: [] });
      const saved = await upsertReturning(admin, "titles", uniq.map(searchRow), "tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: uniq.map((r) => byTmdb.get(r.id)).filter(Boolean) });
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
