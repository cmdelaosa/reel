// tmdb-proxy — Deno edge function (P0-C9).
//
// Routes (under /functions/v1/tmdb-proxy):
//   GET /search?q=                 → { results: TitleRow[] }
//   GET /trending                  → { results: TitleRow[] }
//   GET /popular-now               → { results: TitleRow[] }
//   GET /popular?from=&to=         → { results: TitleRow[] }
//   GET /top-rated?from=&to=&genres= → { results: TitleRow[] }
//   GET /collection/:slug          → { results: TitleRow[] }
//   GET /title/:tmdbId             → { title: TitleRow, seasons: SeasonRow[] }
//   GET /title/:tmdbId/season/:n   → { season: SeasonRow, episodes: EpisodeRow[] }
//
// Every response is served from the metadata cache (rows written with the
// service-role key) — the client never sees raw TMDB payloads. /title and
// /season are cache-first: fresh rows (last_refreshed_at < 24h) skip TMDB
// entirely, stale rows are served immediately and revalidated in the
// background, and only never-cached data blocks on a TMDB fetch. A valid
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
//   • indian/turkish/russian — original language from the Indian subcontinent,
//                      Turkish or Russian: the first two dominate TMDB
//                      popularity, and none are of interest here.
// On top of the hard hides, non-Western titles are *capped* (see capNonWestern).
const ANIMATION_GENRE = 16;
const HIDDEN_GENRES = new Set([10766, 10764]); // Soap, Reality
const ANIME_LANGS = new Set(["ja", "zh", "ko"]);
const HIDDEN_LANGS = new Set(["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "ur", "tr", "ru"]);
// deno-lint-ignore no-explicit-any
const isHidden = (r: any) => {
  const genres: number[] = r?.genre_ids ?? [];
  const lang: string = r?.original_language ?? "";
  if (genres.includes(ANIMATION_GENRE) && ANIME_LANGS.has(lang)) return true; // anime
  if (genres.some((g) => HIDDEN_GENRES.has(g))) return true; // soaps / reality
  if (HIDDEN_LANGS.has(lang)) return true; // indian / turkish / russian
  return false;
};

// East/Southeast Asian dramas dominate TMDB's global popularity, but discovery
// here should be overwhelmingly Western — so beyond the hard hides above,
// non-Western titles are capped rather than hidden. "Western" is judged by
// original language: any European language qualifies (Latin America included
// via es/pt); everything else (ko, ja, zh, th…) competes for the capped slots.
// Search by name is unaffected.
const WESTERN_LANGS = new Set([
  "en", "es", "pt", "fr", "de", "it", "nl", "sv", "da", "no", "nb", "nn", "fi",
  "is", "pl", "cs", "sk", "hu", "ro", "bg", "el", "uk", "hr", "sr", "bs",
  "sl", "mk", "sq", "et", "lv", "lt", "be", "ga", "cy", "ca", "eu", "gl", "mt",
]);
const NON_WESTERN_MAX = 0.1; // at most 1 slot in 10
// Re-ranks a list so non-Western titles fill at most NON_WESTERN_MAX of every
// prefix: Western titles keep their order, and the best-ranked non-Western
// ones are demoted into slots 10, 20, 30… (not dropped — a #1 global hit still
// shows, just below the Western top 9). The prefix property means truncating
// the result anywhere preserves the ratio. Ends with the Western supply, so a
// mostly-Asian tail can't form.
// deno-lint-ignore no-explicit-any
const capNonWestern = (rows: any[]): any[] => {
  const isWestern = (r: Any) => WESTERN_LANGS.has(r?.original_language ?? "");
  const western = rows.filter(isWestern);
  const rest = rows.filter((r) => !isWestern(r));
  const out: Any[] = [];
  let w = 0, n = 0;
  while (w < western.length) {
    if (n < rest.length && n + 1 <= (out.length + 1) * NON_WESTERN_MAX) out.push(rest[n++]);
    else out.push(western[w++]);
  }
  return out;
};

// Spain-origin shows get a guaranteed *floor* (the mirror of the cap above):
// the discover-grid routes fetch extra with_origin_country=ES pages so the
// pool has Spanish supply, and this re-rank promotes the best-ranked Spanish
// titles into slots 6, 12, 18… (~1 in 6), supply permitting. Judged by TMDB's
// origin_country (present on both discover and detail payloads) — language
// won't do, it can't tell Spain from Latin America. Trending and the curated
// collections are left honest.
// ORDER MATTERS: always boost first, cap last — capNonWestern's per-prefix
// guarantee only holds for the list it emits. Boosting afterwards pulls the
// (Western) Spanish rows out of the tail, leaving a tail that over-fills with
// the non-Western titles the cap had spaced out against them.
const SPANISH_MIN = 1 / 6;
const isSpanish = (r: Any) => ((r?.origin_country ?? []) as string[]).includes("ES");
const boostSpanish = (rows: Any[]): Any[] => {
  const spanish = rows.filter(isSpanish);
  const rest = rows.filter((r) => !isSpanish(r));
  const out: Any[] = [];
  let s = 0, o = 0;
  while (o < rest.length) {
    if (s < spanish.length && s + 1 <= Math.floor((out.length + 1) * SPANISH_MIN)) out.push(spanish[s++]);
    else out.push(rest[o++]);
  }
  return out;
};

// Curated-collection slugs → TMDB /discover/tv criteria. Each query must earn
// the tile's *name/sub* (seeded in 0020), not just approximate it: rating sorts
// need a high vote_count floor (fan-niche titles rate 8.6+ on few votes and
// outrank Breaking Bad), and several TMDB genres read wrong on a shelf —
// Comedy includes late-night talk, and Sci-Fi & Fantasy / Drama are dominated
// by Western cartoons unless Animation (16) / Family / Kids are excluded.
const COLLECTION_QUERIES: Record<string, string> = {
  // best-reviewed of all time; the 3000-vote floor keeps acclaimed animation
  // (Arcane, Avatar) while dropping fan-voted teen cartoons
  "critically-acclaimed": "sort_by=vote_average.desc&vote_count.gte=3000",
  // top-rated miniseries — literally watchable in a weekend
  "bingeable-weekend": "with_type=2&sort_by=vote_average.desc&vote_count.gte=1000",
  // sci-fi AND mystery (comma = AND), no cartoons: Dark/Severance/Black Mirror
  // territory. ~66 titles total — a shorter shelf, by design.
  "mind-benders": "with_genres=10765,9648&without_genres=16&sort_by=vote_average.desc&vote_count.gte=500",
  // prestige-drama proxy for awards (TMDB has no award data)
  "award-winners": "with_genres=18&without_genres=16,10751,10762&vote_average.gte=8&sort_by=vote_average.desc&vote_count.gte=3000",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-cache, server-timing",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", ...extraHeaders },
  });

const airDatetime = (airDate?: string | null) =>
  airDate ? `${airDate}${AIR_TIME}` : null;

// deno-lint-ignore no-explicit-any
type Any = any;

// Authoritative aired-episode count from the TMDB title payload. Hand-mirror of
// app/src/domain/airedCount.ts (canonical spec + unit tests) — keep in sync.
function airedCount(seasons: Any[], last: Any): number | null {
  if (!last || (last.season_number ?? 0) <= 0) return null;
  let aired = 0;
  for (const s of seasons ?? []) {
    if ((s.season_number ?? 0) <= 0) continue; // specials
    if (s.season_number < last.season_number) aired += s.episode_count ?? 0;
    else if (s.season_number === last.season_number) aired += last.episode_number;
  }
  return aired;
}

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
    aired_count: airedCount(d.seasons, d.last_episode_to_air),
    last_refreshed_at: new Date().toISOString(),
  };
}

// Search results are partial: only genre_ids (mapped) and no network/status/
// runtime — so we omit those columns to avoid clobbering richer detail rows on
// conflict (PostgREST upsert only updates the columns present in the payload).
// last_refreshed_at is also omitted: it marks a *full detail* refresh (the
// cache-first /title path and the episode-refresh cron key off it), and a
// search hit must not make a title look fresher than its detail data is.
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

// How long a cached title (and its seasons/episodes) is served without any
// TMDB round trip. Matches the daily episode-refresh cron cadence, so followed
// shows are effectively always a cache hit.
const FRESH_MS = 24 * 3600 * 1000;

const isFresh = (title: Any) =>
  Boolean(title?.last_refreshed_at) &&
  Date.now() - new Date(title.last_refreshed_at).getTime() < FRESH_MS;

// Run best-effort work after the response is sent (EdgeRuntime.waitUntil on
// hosted; a detached promise on the local serve runtime, which stays alive).
// Failures are logged, never surfaced to the caller.
function inBackground(work: Promise<unknown>) {
  const guarded = work.catch((err) => console.error(`background refresh: ${String(err)}`));
  (globalThis as Any).EdgeRuntime?.waitUntil?.(guarded);
}

/** TMDB → cache refresh of a title and its season list; returns the
 *  GET /title/:id response shape. Network logos are cached off the hot path. */
async function refreshTitle(admin: SupabaseClient, apiKey: string, tmdbId: number) {
  const d = await fetchTmdb(apiKey, `/tv/${tmdbId}`);
  const [title] = await upsertReturning(admin, "titles", titleRow(d), "tmdb_id");
  inBackground(cacheNetworkLogos(admin, d.networks));
  const seasons = (d.seasons ?? []).length
    ? await upsertReturning(admin, "seasons", d.seasons.map((s: Any) => seasonRow(title.id, s)), "title_id,number")
    : [];
  return { title, seasons };
}

/** TMDB → cache refresh of one season's episodes; returns the
 *  GET /title/:id/season/:n response shape. */
async function refreshSeason(admin: SupabaseClient, apiKey: string, tmdbId: number, titleId: string, n: number) {
  const s = await fetchTmdb(apiKey, `/tv/${tmdbId}/season/${n}`);
  const [season] = await upsertReturning(admin, "seasons", seasonRow(titleId, s), "title_id,number");
  const episodes = (s.episodes ?? []).length
    ? await upsertReturning(
        admin,
        "episodes",
        s.episodes.map((e: Any) => episodeRow(titleId, season.id, e)),
        "title_id,season_number,episode_number",
      )
    : [];
  return { season, episodes };
}

const fetchTmdb = async (apiKey: string, p: string) => {
  const res = await fetch(`${TMDB}${p}${p.includes("?") ? "&" : "?"}api_key=${apiKey}`);
  if (!res.ok) throw new Error(`TMDB ${p}: ${res.status}`); // don't treat an error body as data
  return res.json();
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestStarted = performance.now();

  // --- auth + invite gate in one PostgREST round trip ---
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: invited, error: gateError } = await userClient.rpc("is_current_user_invited");
  if (gateError) return json({ error: "unauthorized" }, 401);
  if (!invited) return json({ error: "not invited" }, 403);
  const gateFinished = performance.now();

  const apiKey = Deno.env.get("TMDB_API_KEY");
  if (!apiKey) return json({ error: "TMDB_API_KEY not configured" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/tmdb-proxy/, "").replace(/\/+$/, "");

  const detailHeaders = (cache: "HIT" | "MISS" | "STALE", dbMs: number, fillMs = 0) => ({
    "X-Cache": cache,
    "Cache-Control": "private, max-age=300, stale-while-revalidate=86400",
    "Vary": "Authorization",
    "Server-Timing": [
      `gate;dur=${(gateFinished - requestStarted).toFixed(1)}`,
      `db;dur=${dbMs.toFixed(1)}`,
      ...(fillMs > 0 ? [`fill;dur=${fillMs.toFixed(1)}`] : []),
      `total;dur=${(performance.now() - requestStarted).toFixed(1)}`,
    ].join(", "),
  });

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
        const deduped: Any[] = [];
        for (const r of pages.flatMap((d) => d.results ?? [])) {
          if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); deduped.push(r); }
        }
        const results = capNonWestern(deduped);
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
          // Spanish supply for the boostSpanish floor: same premiere windows,
          // Spain-only. Global pages rarely carry Spanish shows deep enough.
          `/discover/tv?sort_by=popularity.desc&include_adult=false&with_origin_country=ES&air_date.gte=${since}&air_date.lte=${until}&page=1`,
          `/discover/tv?sort_by=popularity.desc&include_adult=false&with_origin_country=ES&first_air_date.gte=${since}&first_air_date.lte=${until}&page=1`,
        ];
        const pages = await Promise.all(queries.map((q) => fetchTmdb(apiKey, q)));
        const seen = new Set<number>();
        const candidates: Any[] = [];
        for (const r of pages.flatMap((d) => d.results ?? [])) {
          if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); candidates.push(r); }
        }
        candidates.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
        // Cap + boost before the detail-check so the fetch budget isn't spent
        // on titles the quota would drop anyway (and so Spanish candidates
        // survive into the top CANDIDATES); both run again after the premiere
        // gate below, since dropping non-premiering rows skews ratios back.
        const pool = capNonWestern(boostSpanish(candidates));
        pool.length = Math.min(pool.length, CANDIDATES);
        // Detail-check in chunks (TMDB rate limit): keep shows with a real
        // season (not specials) premiering inside the window.
        const premiered: Any[] = [];
        const CHUNK = 20;
        for (let i = 0; i < pool.length; i += CHUNK) {
          const details = await Promise.all(
            pool.slice(i, i + CHUNK).map((c) => fetchTmdb(apiKey, `/tv/${c.id}`).catch(() => null)),
          );
          for (const d of details) {
            if (!d) continue;
            const hasPremiere = (d.seasons ?? []).some((s: Any) =>
              (s.season_number ?? 0) > 0 && s.air_date && s.air_date >= since && s.air_date <= until);
            if (hasPremiere) premiered.push(d);
          }
        }
        premiered.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
        const keep = capNonWestern(boostSpanish(premiered));
        keep.length = Math.min(keep.length, KEEP);
        if (keep.length) {
          // We hold full details here, so upsert the rich row (network, status…).
          await upsertReturning(admin, "titles", keep.map(titleRow), "tmdb_id");
          await cacheNetworkLogos(admin, keep.flatMap((d: Any) => d.networks ?? []));
          ranked = keep.map((d, i) => ({ tmdb_id: d.id as number, rank: i + 1 }));
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
      const ES_PAGES = 2; // Spanish supply for the boostSpanish floor
      const pages = await Promise.all([
        ...Array.from({ length: PAGES }, (_, i) =>
          fetchTmdb(apiKey, `/discover/tv?sort_by=popularity.desc&include_adult=false&page=${i + 1}${yearParams}`)),
        ...Array.from({ length: ES_PAGES }, (_, i) =>
          fetchTmdb(apiKey, `/discover/tv?sort_by=popularity.desc&include_adult=false&with_origin_country=ES&page=${i + 1}${yearParams}`)),
      ]);
      // Dedupe across pages before upserting — a repeated tmdb_id in one upsert
      // batch errors ("cannot affect row a second time").
      const seen = new Set<number>();
      const deduped: Any[] = [];
      for (const r of pages.flatMap((d) => d.results ?? [])) {
        if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); deduped.push(r); }
      }
      const uniq = capNonWestern(boostSpanish(deduped));
      if (uniq.length === 0) return json({ results: [] });
      const saved = await upsertReturning(admin, "titles", uniq.map(searchRow), "tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: uniq.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /top-rated?from=YYYY&to=YYYY&genres=18,80  (TMDB /discover/tv sorted
    // by rating; genre ids are OR-ed). The vote_count floor is the honesty
    // knob — fan-niche titles rate 8.6+ on few votes — but a fixed high floor
    // starves filtered charts (the 1970s have two 1000-vote shows, Documentary
    // has zero at 3000), so it slides with the era and drops when a genre is
    // picked. When `from` sits in the last few years the whole range is too
    // young to have accrued votes (a 2026 premiere can't reach 1000), so the
    // floor collapses as `from` approaches today. boostSpanish is deliberately
    // skipped: injecting lower-rated titles would falsify a by-rating chart;
    // capNonWestern only demotes, so the order within Western titles stays
    // honest.
    if (path === "/top-rated") {
      const from = url.searchParams.get("from") || null;
      const to = url.searchParams.get("to") || null;
      const genres = (url.searchParams.get("genres") ?? "")
        .split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      const thisYear = new Date().getUTCFullYear();
      const era = Number(from ?? to); // older bound of the range
      const eraFloor =
        !from && !to ? 3000
        : Number(from) >= thisYear - 1 ? 50 // range is brand-new — votes haven't accrued yet
        : Number(from) >= thisYear - 4 ? 300
        : era >= 2005 ? 1000
        : era >= 1990 ? 500
        : 200;
      const minVotes = genres.length ? Math.min(eraFloor, 500) : eraFloor;
      const params =
        `&sort_by=vote_average.desc&vote_count.gte=${minVotes}` +
        (from ? `&first_air_date.gte=${from}-01-01` : "") +
        (to ? `&first_air_date.lte=${to}-12-31` : "") +
        (genres.length ? `&with_genres=${genres.join("%7C")}` : "");
      const PAGES = 8;
      const pages = await Promise.all(
        Array.from({ length: PAGES }, (_, i) =>
          fetchTmdb(apiKey, `/discover/tv?include_adult=false${params}&page=${i + 1}`)),
      );
      const seen = new Set<number>();
      const deduped: Any[] = [];
      for (const r of pages.flatMap((d) => d.results ?? [])) {
        if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); deduped.push(r); }
      }
      const uniq = capNonWestern(deduped);
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
      const deduped: Any[] = [];
      for (const r of pages.flatMap((d) => d.results ?? [])) {
        if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); deduped.push(r); }
      }
      const uniq = capNonWestern(deduped);
      if (uniq.length === 0) return json({ results: [] });
      const saved = await upsertReturning(admin, "titles", uniq.map(searchRow), "tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: uniq.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /title/:id — cache-first. A cached title WITH season rows is served
    // straight from the DB; if it's stale it is still served now and
    // revalidated behind the response. Only a never-cached title — or one only
    // partially cached by search/discover, which never write seasons — blocks
    // on TMDB.
    const mTitle = path.match(/^\/title\/(\d+)$/);
    if (mTitle) {
      const tmdbId = Number(mTitle[1]);
      const dbStarted = performance.now();
      const { data: cached } = await admin
        .from("titles")
        .select("*, seasons(*)")
        .eq("tmdb_id", tmdbId)
        .maybeSingle();
      const dbMs = performance.now() - dbStarted;
      if (cached && (cached.seasons ?? []).length) {
        const { seasons: nestedSeasons, ...title } = cached;
        const seasons = [...nestedSeasons].sort((a: Any, b: Any) => a.number - b.number);
        const stale = !isFresh(title);
        if (stale) inBackground(refreshTitle(admin, apiKey, tmdbId));
        return json({ title, seasons }, 200, detailHeaders(stale ? "STALE" : "HIT", dbMs));
      }
      const fillStarted = performance.now();
      const filled = await refreshTitle(admin, apiKey, tmdbId);
      return json(filled, 200, detailHeaders("MISS", dbMs, performance.now() - fillStarted));
    }

    // GET /title/:id/season/:n — cache-first like /title. Cached episodes are
    // considered stale when the title row is stale or the row count disagrees
    // with the season's announced episode_count (an episode was added since);
    // both still serve the cache and revalidate behind the response. Only a
    // season with no cached episodes blocks on TMDB.
    const mSeason = path.match(/^\/title\/(\d+)\/season\/(\d+)$/);
    if (mSeason) {
      const tmdbId = Number(mSeason[1]);
      const n = Number(mSeason[2]);
      const dbStarted = performance.now();
      const { data: existing } = await admin
        .from("titles").select("id, last_refreshed_at").eq("tmdb_id", tmdbId).maybeSingle();
      const title = existing ?? (await refreshTitle(admin, apiKey, tmdbId)).title;
      const { data: season } = await admin
        .from("seasons").select("*, episodes(*)").eq("title_id", title.id).eq("number", n).maybeSingle();
      const dbMs = performance.now() - dbStarted;
      if (season) {
        const { episodes: nestedEpisodes, ...seasonRow } = season;
        const episodes = [...(nestedEpisodes ?? [])].sort((a: Any, b: Any) => a.episode_number - b.episode_number);
        if ((episodes ?? []).length) {
          const complete = seasonRow.episode_count == null || episodes.length >= seasonRow.episode_count;
          const stale = !isFresh(title) || !complete;
          if (stale) inBackground(refreshSeason(admin, apiKey, tmdbId, title.id, n));
          return json({ season: seasonRow, episodes }, 200, detailHeaders(stale ? "STALE" : "HIT", dbMs));
        }
      }
      const fillStarted = performance.now();
      const filled = await refreshSeason(admin, apiKey, tmdbId, title.id, n);
      return json(filled, 200, detailHeaders("MISS", dbMs, performance.now() - fillStarted));
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
});
