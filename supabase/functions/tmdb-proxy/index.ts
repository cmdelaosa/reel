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
// Filling a season from scratch (nobody had opened this show before) also pulls
// the show's remaining seasons in behind the response — see fillWholeShow. The
// IMDb ratings importer can only rate episode rows we already hold, so a show
// half-ingested is a show half-graphed.
//
// air_datetime: TMDB gives an air_date (day) but no time, so the upsert stamps
// 21:00 UTC as a placeholder and a background pass overwrites it with TVmaze's
// real airstamp where TVmaze carries the show (see enrichAirTimes). Rows keep
// air_time_source = 'estimated' until that lands, and the client shows a bare
// date rather than a made-up clock for them. TMDB's day is kept alongside, in
// air_date, and bounds the whole exchange: TVmaze may set the hour within that
// day and may never move the episode off it (see the air-time pairing block).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { boostSpanish, capNonWestern } from "./rank.ts";

const TMDB = "https://api.themoviedb.org/3";
const TVMAZE = "https://api.tvmaze.com";

/* Which TVmaze stamp may time one of our episodes — TMDB's day is the anchor
   and TVmaze may only set the hour within it. Hand-mirror of
   app/src/domain/airPairing.ts (canonical spec + unit tests + a source-vs-source
   mirror test); the block below is compared verbatim, so edit it there. */
// ── air-time pairing ─────────────────────────────────────────────────────────
// Spec + tests: app/src/domain/airPairing.ts — keep the three copies identical.

/** The 21:00 UTC placeholder stapled onto TMDB's bare day. Correct to the day
 *  from UTC-3 to UTC+2 and a day out in Asia-Pacific; the UI prints no clock
 *  for these rows (hasRealAirTime), so the hour is never shown, only used to
 *  order the calendar and decide what has aired. */
export const AIR_TIME = "T21:00:00Z";

/** One episode as TVmaze publishes it. `airdate` is the broadcaster's local
 *  day — the field we pair on; `airstamp` is the absolute instant we store. */
export interface TvmazeEpisode {
  season?: number | null;
  number?: number | null;
  airdate?: string | null;
  airstamp?: string | null;
}

/** One of our episode rows, with the TMDB day that anchors it. `air_date` is
 *  null only for rows written before migration 0060 — those can't be judged
 *  and are left alone until a refresh records one. */
export interface AnchoredEpisode {
  season_number: number;
  episode_number: number;
  air_date?: string | null;
}

export type AirTimeSource = "tvmaze" | "estimated";

export interface AirTime {
  air_datetime: string;
  air_time_source: AirTimeSource;
}

/** TVmaze's episodes under both keys the pairing needs: the number it claims,
 *  and the day it actually aired. */
export interface TvmazeIndex {
  byNumber: Map<string, TvmazeEpisode>;
  byDate: Map<string, TvmazeEpisode[]>;
  size: number;
}

export function indexTvmaze(eps: readonly TvmazeEpisode[] | null | undefined): TvmazeIndex {
  const byNumber = new Map<string, TvmazeEpisode>();
  const byDate = new Map<string, TvmazeEpisode[]>();
  for (const e of eps ?? []) {
    // Specials are out of scope on both sides of the comparison, the way every
    // gate in the app filters season_number > 0.
    if (!e?.airstamp || e.season == null || e.number == null || e.season <= 0) continue;
    byNumber.set(`${e.season}x${e.number}`, e);
    if (e.airdate) {
      const sameDay = byDate.get(e.airdate);
      if (sameDay) sameDay.push(e);
      else byDate.set(e.airdate, [e]);
    }
  }
  return { byNumber, byDate, size: byNumber.size };
}

/** The stamp TVmaze offers for this row, or null when it can't prove one.
 *
 *  Two ways to match, in order. The same season × number, WHEN it agrees with
 *  TMDB's day — the ordinary case, and the cheap one. Failing that, the single
 *  episode TVmaze aired on that day, whatever number it wears: this is what
 *  re-aligns a catalogue counting episodes differently. `single` is the whole
 *  safety of the fallback — a day carrying two or more episodes (a double bill,
 *  a season dumped at once) can't be resolved by date, so it gets no clock
 *  rather than a coin flip. */
function pairedStamp(ep: AnchoredEpisode, idx: TvmazeIndex): string | null {
  const sameNumber = idx.byNumber.get(`${ep.season_number}x${ep.episode_number}`);
  if (sameNumber && sameNumber.airdate === ep.air_date) return new Date(sameNumber.airstamp!).toISOString();
  const sameDay = idx.byDate.get(ep.air_date!) ?? [];
  return sameDay.length === 1 ? new Date(sameDay[0].airstamp!).toISOString() : null;
}

/** The air time a row should hold, given TMDB's day and what TVmaze published.
 *
 *  null means "leave this row alone": without an anchor there is nothing to
 *  judge a stamp against, and guessing is how the rows got wrong in the first
 *  place.
 *
 *  Otherwise the answer is total, and that matters — a row TVmaze can no longer
 *  account for is handed back to TMDB's day with the placeholder, rather than
 *  keeping an instant nothing supports any more. That is what repairs the
 *  episodes the old number-only pairing mis-stamped. Callers must therefore
 *  only reach here on a SUCCESSFUL TVmaze read (idx.size > 0); an outage that
 *  returned nothing would otherwise demote a whole title's calendar. */
export function resolveAirTime(ep: AnchoredEpisode, idx: TvmazeIndex): AirTime | null {
  if (!ep.air_date) return null;
  const stamp = pairedStamp(ep, idx);
  return stamp
    ? { air_datetime: stamp, air_time_source: "tvmaze" }
    : { air_datetime: `${ep.air_date}${AIR_TIME}`, air_time_source: "estimated" };
}
// ── end air-time pairing ─────────────────────────────────────────────────────

/* Every upstream call is capped: a third party that accepts the connection but
   never answers would otherwise hang `await fetch` forever, holding the request
   (a MISS blocks on TMDB) or a background task open until the platform kills the
   invocation. Rejections are already handled — fetchTmdb throws into the route's
   try/catch (502), the TVmaze pass degrades to a silent no-op. Mirrors
   episode-refresh's UPSTREAM_TIMEOUT_MS; keep the two in step. */
const UPSTREAM_TIMEOUT_MS = 10_000;

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

// The two discovery re-rankers (non-Western cap, Spanish floor) live in
// ./rank.ts so they can be unit-tested — Deno.serve below runs at import time,
// which makes anything defined in this file untestable. ORDER MATTERS at every
// call site: always boost first, cap last (rank.ts explains why).

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

// Authoritative "next announced season" from the TMDB title payload. Hand-mirror
// of app/src/domain/airedCount.ts → computeUpcomingSeason (canonical spec + unit
// tests) — keep in sync.
function upcomingSeason(seasons: Any[], last: Any, next: Any): { number: number; air_date: string | null } | null {
  if (!last || (last.season_number ?? 0) <= 0) return null;
  if (next && next.season_number === last.season_number) return null; // still airing the current season
  let best: { number: number; air_date: string | null } | null = null;
  for (const s of seasons ?? []) {
    if ((s.season_number ?? 0) <= last.season_number) continue; // specials + already-aired/airing
    if (!best || s.season_number < best.number) best = { number: s.season_number, air_date: s.air_date || null };
  }
  return best;
}

// Spain-Spanish translation from a detail payload fetched with
// append_to_response=translations (es-ES preferred, plain es as fallback).
function esTranslation(d: Any): { name: string | null; overview: string | null } {
  const all: Any[] = d?.translations?.translations ?? [];
  const t =
    all.find((x) => x.iso_639_1 === "es" && x.iso_3166_1 === "ES") ??
    all.find((x) => x.iso_639_1 === "es");
  return { name: t?.data?.name || null, overview: t?.data?.overview || null };
}

/* Hand-mirrors app/src/domain/watchProviders.ts — the canonical spec, with the
   unit tests. Keep the two in step.

   TMDB names the same brand differently as a provider than as a network
   ("Disney Plus" vs "Disney+"), and splits the ad-supported tiers out as their
   own entries. Both matter downstream: the client renders providers through
   the very same NetworkLogo that switches on these exact strings, and the
   logo cache is keyed by name. Canonicalising here keeps one spelling per
   brand in the column, the cache and the UI. */
const PROVIDER_ALIASES: Record<string, string> = {
  "Amazon Prime Video": "Prime Video",
  "Disney Plus": "Disney+",
  "Apple TV Plus": "Apple TV+",
  // TMDB renamed the subscription service to plain "Apple TV" (the rent/buy
  // storefront is "Apple TV Store"), and we only read subscription buckets.
  "Apple TV": "Apple TV+",
};

// A service resold through another storefront ("HBO Max Amazon Channel") is the
// same service, and TMDB ships some names with a trailing space.
const RESELLER = /\s+(amazon|apple tv|roku)\s+channel$/i;
// The tier word is optional: TMDB ships a bare "Amazon Prime Video with Ads".
const AD_TIER = /\s+(basic\s+|standard\s+)?with\s+ads$/i;

function canonicalProvider(name: string): string {
  const base = name.replace(RESELLER, "").replace(AD_TIER, "").trim();
  return PROVIDER_ALIASES[base] ?? base;
}

/** TMDB watch/providers → {ES: [{name, logo_path}], …}, ready for the column.
 *
 *  Subscription-shaped access only: `flatrate` (included with a sub), `free`
 *  and `ads`. `rent`/`buy` are dropped — nearly every catalogue title is
 *  rentable on Apple TV and Google Play, so keeping them would stamp the same
 *  two logos on half the library. Within a country TMDB already orders by
 *  display_priority, and a provider appearing in two buckets is kept once, at
 *  its best position.
 *
 *  Returns undefined only when the payload carried no `watch/providers` block
 *  at all — a fetch made without the append — so those callers leave the column
 *  untouched rather than wiping it, the same rule the translations above
 *  follow. A payload that *did* carry the block but lists nothing we keep
 *  returns {} and does overwrite: availability really has gone to zero, and
 *  saying so is the point. */
function providerMap(d: Any): Record<string, { name: string; logo_path: string | null }[]> | undefined {
  const results = d?.["watch/providers"]?.results;
  if (!results || typeof results !== "object") return undefined;

  const out: Record<string, { name: string; logo_path: string | null }[]> = {};
  for (const [country, buckets] of Object.entries(results as Record<string, Any>)) {
    const seen = new Set<string>();
    // Also dedup on artwork: a sub-package ("Movistar Plus+ Ficción Total")
    // shares its parent's icon, so a show on both drew the same tile twice.
    const seenArt = new Set<string>();
    const list: { name: string; logo_path: string | null }[] = [];
    for (const bucket of ["flatrate", "free", "ads"] as const) {
      for (const p of (buckets?.[bucket] ?? []) as Any[]) {
        if (!p?.provider_name) continue;
        // Dedup on the canonical name, not provider_id: the ad-supported tier
        // is a separate id, and un-deduped it would put two Netflix logos on
        // the same poster.
        const name = canonicalProvider(p.provider_name as string);
        const art = (p.logo_path ?? null) as string | null;
        if (seen.has(name) || (art && seenArt.has(art))) continue;
        seen.add(name);
        if (art) seenArt.add(art);
        list.push({ name, logo_path: art });
      }
    }
    // Sub-packages: drop an entry that merely extends another in the same
    // country. Spain returns "Movistar Plus+" and "Movistar Plus+ Ficción
    // Total" for one show, near-identical icons under different file names.
    // Parent wins whatever the order; an add-on listed alone keeps its name.
    const merged = list.filter((a) => !list.some((b) => b !== a && a.name.startsWith(`${b.name} `)));
    // A country left with nothing — only rent/buy, say — stores nothing, which
    // the client reads as "not available here", because that is what it means.
    if (merged.length) out[country] = merged;
  }
  return out;
}

function titleRow(d: Any) {
  const up = upcomingSeason(d.seasons, d.last_episode_to_air, d.next_episode_to_air);
  const providers = providerMap(d);
  // Localized columns ride along only when the payload actually carried
  // translations — other callers (popular-now detail checks) must not null
  // out values a full refresh already wrote.
  const es = d.translations ? esTranslation(d) : null;
  return {
    tmdb_id: d.id,
    kind: "tv",
    name: d.name ?? d.original_name ?? "Untitled",
    original_name: d.original_name ?? null,
    ...(es ? { name_es: es.name, overview_es: es.overview } : {}),
    overview: d.overview ?? null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    first_air_date: d.first_air_date || null,
    status: d.status ?? null,
    // Bridge to TVmaze, which indexes IMDb/TVDB ids and knows nothing of TMDB's.
    ...(d.external_ids ? { imdb_id: d.external_ids.imdb_id || null } : {}),
    genres: (d.genres ?? []).map((g: Any) => g.name),
    network: d.networks?.[0]?.name ?? null,
    // Like the translations above: present only when the payload carried it,
    // so a fetch made without the append can't wipe a full one.
    ...(providers ? { providers } : {}),
    episode_run_time: d.episode_run_time?.[0] ?? null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    aired_count: airedCount(d.seasons, d.last_episode_to_air),
    upcoming_season_number: up?.number ?? null,
    upcoming_season_air_date: up?.air_date ?? null,
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

/* episode_count rides along only when the payload carries it: the title payload
   does, a season payload does not. Omitted rather than nulled — the rule the
   translations and providers above already follow — because fetching a season
   directly would otherwise wipe the announced count the title refresh wrote, and
   that count is exactly what /season compares its row count against to notice a
   season has gained an episode. */
const seasonRow = (titleId: string, s: Any) => ({
  title_id: titleId,
  tmdb_id: s.id ?? null,
  number: s.season_number,
  name: s.name ?? null,
  ...(s.episode_count != null ? { episode_count: s.episode_count } : {}),
  air_date: s.air_date || null,
});

/** `keep` carries the air times TVmaze already resolved for this title (see
 *  keepTvmazeTimes). An upsert writes every column in its payload, so without it
 *  a refresh would stamp the placeholder over good data and rely on the
 *  enrichment pass — which is allowed to fail silently — to put it back. */
const episodeRow = (
  titleId: string,
  seasonId: string,
  e: Any,
  keep: Map<string, { at: string; airDate: string | null }>,
) => {
  // Only carried through while TMDB still reports the same day for it — see
  // keepTvmazeTimes. Otherwise it goes back to the placeholder and the
  // enrichment pass re-pairs it against the day.
  const held = keep.get(`${e.season_number}x${e.episode_number}`);
  const known = held && held.airDate && held.airDate === (e.air_date || null) ? held.at : null;
  return {
    title_id: titleId,
    season_id: seasonId,
    tmdb_id: e.id ?? null,
    season_number: e.season_number,
    episode_number: e.episode_number,
    name: e.name ?? null,
    overview: e.overview ?? null,
    runtime: e.runtime ?? null,
    // Per-episode TMDB score — free (already in this payload) and the second
    // source behind the episode graph. IMDb ratings come from the weekly
    // dataset import (scripts/imdb-ratings), which owns those columns.
    tmdb_vote_average: e.vote_average ?? null,
    tmdb_vote_count: e.vote_count ?? null,
    // TMDB's bare day, kept as the anchor every TVmaze stamp is checked against
    // (0060) — the instant beside it may be TVmaze's.
    air_date: e.air_date || null,
    // Placeholder for genuinely new episodes only; value and provenance always
    // move together, so the pair can never disagree.
    air_datetime: known ?? airDatetime(e.air_date),
    air_time_source: known ? "tvmaze" : "estimated",
  };
};

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

/** Air times already resolved from TVmaze for this title, keyed
 *  `season x episode` and carrying the TMDB day each was proven against, so a
 *  TMDB refresh can bring them through its upsert instead of overwriting them
 *  with the 21:00 UTC placeholder. Without this a single failed enrichment
 *  (TVmaze outage, rate limit, show missing from their catalogue) would leave
 *  real air times lost until the next successful run.
 *
 *  The day rides along because carrying an instant through is only sound while
 *  TMDB still reports the same air_date for it (0060) — otherwise a reschedule,
 *  or a row the old number-only pairing mis-stamped, would be preserved forever
 *  by the very guard meant to protect good data. */
async function keepTvmazeTimes(
  admin: SupabaseClient,
  titleId: string,
): Promise<Map<string, { at: string; airDate: string | null }>> {
  const { data } = await admin
    .from("episodes")
    .select("season_number, episode_number, air_datetime, air_date")
    .eq("title_id", titleId)
    .eq("air_time_source", "tvmaze");
  const keep = new Map<string, { at: string; airDate: string | null }>();
  for (const e of (data ?? []) as Any[]) {
    if (e.air_datetime) {
      keep.set(`${e.season_number}x${e.episode_number}`, { at: e.air_datetime, airDate: e.air_date ?? null });
    }
  }
  return keep;
}

/** TVmaze's show id for one of our titles, resolved through the IMDb id TMDB
 *  hands us (TVmaze indexes IMDb/TVDB, never TMDB) and cached on the row so the
 *  lookup costs one request per show, ever. /lookup answers 301 → 200; 404 just
 *  means TVmaze doesn't carry it. */
async function tvmazeShowId(admin: SupabaseClient, title: Any): Promise<number | null> {
  if (title.tvmaze_id) return title.tvmaze_id;
  if (!title.imdb_id) return null;
  const res = await fetch(`${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(title.imdb_id)}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const id = (await res.json())?.id ?? null;
  if (id) await admin.from("titles").update({ tvmaze_id: id }).eq("id", title.id);
  return id;
}

/** Replace a title's 21:00 UTC placeholders with TVmaze's real airstamps —
 *  absolute instants with the broadcaster's DST already resolved, so no
 *  timezone arithmetic on our side — but only ever *within* the day TMDB
 *  reports, which is what resolveAirTime enforces. Best-effort: TVmaze being
 *  down, or simply not carrying the show, leaves the estimates (and their
 *  'estimated' marker) exactly as they were. Specials are skipped — TVmaze
 *  numbers them on its own scheme and every gate in the app filters
 *  season_number > 0 anyway. */
async function enrichAirTimes(admin: SupabaseClient, titleId: string) {
  const { data: title } = await admin
    .from("titles").select("id, imdb_id, tvmaze_id").eq("id", titleId).maybeSingle();
  if (!title) return;

  const showId = await tvmazeShowId(admin, title);
  if (!showId) return;

  const res = await fetch(`${TVMAZE}/shows/${showId}/episodes`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return;
  const idx = indexTvmaze(await res.json());
  // Nothing usable came back (outage, empty catalogue). Returning here is what
  // makes resolveAirTime's total answer safe to act on below: a bad read must
  // never be read as "TVmaze no longer accounts for any of these episodes".
  if (!idx.size) return;

  const { data: ours } = await admin
    .from("episodes")
    .select("title_id, season_number, episode_number, air_date, air_datetime, air_time_source")
    .eq("title_id", titleId)
    .gt("season_number", 0);

  const rows: Any[] = [];
  for (const e of (ours ?? []) as Any[]) {
    const want = resolveAirTime(e, idx);
    if (!want) continue; // no TMDB day recorded yet — nothing to judge it against
    // Compare as instants, not strings: Postgres renders timestamptz with a
    // +00:00 offset where toISOString() writes a Z, so a textual diff would
    // rewrite every episode on every pass.
    if (
      want.air_time_source === e.air_time_source &&
      new Date(e.air_datetime ?? 0).getTime() === new Date(want.air_datetime).getTime()
    ) continue;
    rows.push({
      title_id: e.title_id,
      season_number: e.season_number,
      episode_number: e.episode_number,
      air_datetime: want.air_datetime,
      air_time_source: want.air_time_source,
    });
  }
  if (!rows.length) return;

  const { error } = await admin
    .from("episodes").upsert(rows, { onConflict: "title_id,season_number,episode_number" });
  if (error) console.error(`tvmaze air times: ${error.message}`);
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
  // watch/providers rides the append: no extra request, and TMDB hands back
  // every country at once, so switching country never refetches anything.
  const d = await fetchTmdb(apiKey, `/tv/${tmdbId}?append_to_response=translations,external_ids,watch/providers`);
  const [title] = await upsertReturning(admin, "titles", titleRow(d), "tmdb_id");
  inBackground(cacheNetworkLogos(admin, d.networks));
  const seasons = (d.seasons ?? []).length
    ? await upsertReturning(admin, "seasons", d.seasons.map((s: Any) => seasonRow(title.id, s)), "title_id,number")
    : [];
  return { title, seasons };
}

/** TMDB → cache refresh of one season's episodes; returns the
 *  GET /title/:id/season/:n response shape. `enrich` is turned off by the
 *  whole-show fill below, which runs a single TVmaze pass at the end instead of
 *  one per season — they all fetch the same show's episode list. */
async function refreshSeason(
  admin: SupabaseClient,
  apiKey: string,
  tmdbId: number,
  titleId: string,
  n: number,
  enrich = true,
) {
  const s = await fetchTmdb(apiKey, `/tv/${tmdbId}/season/${n}`);
  const [season] = await upsertReturning(admin, "seasons", seasonRow(titleId, s), "title_id,number");
  // Read before the first episode write, so the upsert can carry known air
  // times through instead of clobbering them.
  const keep = await keepTvmazeTimes(admin, titleId);
  const episodes = (s.episodes ?? []).length
    ? await upsertReturning(
        admin,
        "episodes",
        s.episodes.map((e: Any) => episodeRow(titleId, season.id, e, keep)),
        "title_id,season_number,episode_number",
      )
    : [];
  // Off the hot path, like the network logos above. Episodes we had already
  // dated keep their real time in the response; only genuinely new ones can
  // still read as an estimate until the background pass lands.
  if (episodes.length && enrich) inBackground(enrichAirTimes(admin, titleId));
  return { season, episodes };
}

/** The regular (non-special) season numbers we hold for a title, ascending. */
async function regularSeasons(admin: SupabaseClient, titleId: string): Promise<number[]> {
  const { data } = await admin
    .from("seasons").select("number").eq("title_id", titleId).gt("number", 0).order("number");
  return (data ?? []).map((s: Any) => s.number as number);
}

/* Pull a whole show into the cache, behind the response, the first time one of
   its seasons has to be filled from scratch — i.e. the first time anyone opens a
   show nobody follows.

   WHY THE WHOLE SHOW. Episode rows are what the IMDb ratings importer
   (scripts/imdb-ratings) rates: it only ever UPDATES rows we already hold, never
   invents them. Filling just the season on screen means tonight's run rates only
   that one, and tomorrow the season picker has a graph on the season somebody
   happened to open and nothing on the rest — which reads as broken rather than
   as pending. The same fetch also writes each episode's TMDB score, so the
   episode sub-sheet fills in too.

   Idempotent and self-limiting: seasons that already hold episodes are skipped,
   so a later cold season (a premiere) costs one request, not a whole show.

   `seeded` says whether the caller's own season wrote any episodes — it refreshed
   with enrichment off on the promise that the single TVmaze pass at the end
   covers it. */
async function fillWholeShow(
  admin: SupabaseClient,
  apiKey: string,
  tmdbId: number,
  titleId: string,
  seeded: boolean,
) {
  let seasons = await regularSeasons(admin, titleId);
  // No season list cached yet: the client's /title call may still be in flight,
  // or the row came from popular-now, which writes titles without seasons. The
  // title refresh writes every season row — and, the reason it earns its place
  // here, the imdb_id the ratings importer matches this show by. Without it the
  // episodes we are about to write could never be rated.
  if (seasons.length <= 1) {
    await refreshTitle(admin, apiKey, tmdbId);
    seasons = await regularSeasons(admin, titleId);
  }
  let wrote = seeded;
  for (const n of seasons) {
    const { count } = await admin
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("title_id", titleId)
      .eq("season_number", n);
    if (count) continue; // already held — the caller's season, or an earlier fill
    const { episodes } = await refreshSeason(admin, apiKey, tmdbId, titleId, n, false);
    if (episodes.length) wrote = true;
  }
  // One TVmaze pass for the lot — it fetches the show's whole episode list
  // either way. Skipped when nothing was written: a season TMDB has no episodes
  // for yet (an announced one) MISSes on every single open, and re-dating a show
  // that gained no rows is pure upstream traffic.
  if (wrote) await enrichAirTimes(admin, titleId);
}

const fetchTmdb = async (apiKey: string, p: string) => {
  const res = await fetch(`${TMDB}${p}${p.includes("?") ? "&" : "?"}api_key=${apiKey}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
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
    // GET /search?q=&lang=es — TMDB matches translated names/AKAs regardless of
    // the language param (a query in Spanish already finds the show); lang=es
    // additionally fetches the es-ES translation set and patches name_es/
    // original_name so the palette can display Spanish titles. The canonical
    // columns always come from the default-language fetch.
    if (path === "/search") {
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ results: [] });
      const wantEs = url.searchParams.get("lang") === "es";
      const [data, esData] = await Promise.all([
        fetchTmdb(apiKey, `/search/tv?query=${encodeURIComponent(q)}&include_adult=false`),
        wantEs
          ? fetchTmdb(apiKey, `/search/tv?query=${encodeURIComponent(q)}&include_adult=false&language=es-ES`).catch(() => null)
          : Promise.resolve(null),
      ]);
      const results: Any[] = data.results ?? [];
      if (results.length === 0) return json({ results: [] });
      let saved = await upsertReturning(admin, "titles", results.map(searchRow), "tmdb_id");
      const esById = new Map(((esData?.results ?? []) as Any[]).map((r) => [r.id, r]));
      if (wantEs && esById.size > 0) {
        const patches = results
          .map((r) => {
            const es = esById.get(r.id);
            if (!es) return null;
            return {
              tmdb_id: r.id,
              kind: "tv",
              name: r.name ?? r.original_name ?? "Untitled",
              original_name: es.original_name ?? r.original_name ?? null,
              // es fetch falls back to the original name when no translation
              // exists — only store a real Spanish title.
              name_es: es.name && es.name !== es.original_name ? es.name : null,
            };
          })
          .filter(Boolean);
        if (patches.length) saved = await upsertReturning(admin, "titles", patches, "tmdb_id");
      }
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
            // Same request count with the appends, and it means a discover row
            // already carries its providers and Spanish title the first time it
            // is rendered. external_ids is not a nicety here: titleRow stamps
            // last_refreshed_at, so a payload without it writes a row that looks
            // fully refreshed to /title while imdb_id stays null — and imdb_id is
            // the ONLY key the ratings importer matches a show by, so those
            // titles were invisible to it for good (no episode graph, no IMDb
            // score on the sheet). Keep this append in step with refreshTitle's.
            pool.slice(i, i + CHUNK).map((c) =>
              fetchTmdb(apiKey, `/tv/${c.id}?append_to_response=translations,external_ids,watch/providers`).catch(() => null)),
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

    // GET /title/:id/credits — aggregate TV cast straight from TMDB (no DB
    // cache: credits change rarely and the response is small; the browser
    // caches it via max-age below and React Query holds it per session).
    const mCredits = path.match(/^\/title\/(\d+)\/credits$/);
    if (mCredits) {
      const d = await fetchTmdb(apiKey, `/tv/${mCredits[1]}/aggregate_credits`);
      const cast = ((d.cast ?? []) as Any[])
        .slice(0, 24)
        .map((c) => ({
          id: c.id,
          name: c.name ?? "",
          profile_path: c.profile_path ?? null,
          character: c.roles?.[0]?.character ?? null,
          episode_count: c.total_episode_count ?? null,
        }));
      return json({ cast }, 200, { "Cache-Control": "private, max-age=86400" });
    }

    // GET /person/:id — actor header + their TV credits, shaped for the person
    // page. Self/talk-show guest spots are dropped unless the run was long
    // enough to matter; the client resolves library status / your rating.
    const mPerson = path.match(/^\/person\/(\d+)$/);
    if (mPerson) {
      const d = await fetchTmdb(apiKey, `/person/${mPerson[1]}?append_to_response=tv_credits,translations`);
      const seen = new Set<number>();
      const shows: Any[] = [];
      const credits = [...((d.tv_credits?.cast ?? []) as Any[])]
        .sort((a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0));
      for (const c of credits) {
        if (c?.id == null || seen.has(c.id)) continue;
        const character: string = c.character ?? "";
        const selfish = /^(self|himself|herself|themselves)\b/i.test(character.trim());
        if ((selfish || !character) && (c.episode_count ?? 0) < 5) continue;
        seen.add(c.id);
        shows.push({
          tmdb_id: c.id,
          name: c.name ?? c.original_name ?? "Untitled",
          poster_path: c.poster_path ?? null,
          first_air_date: c.first_air_date || null,
          vote_average: c.vote_average ?? null,
          character: character || null,
          episode_count: c.episode_count ?? null,
        });
      }
      // es-ES biography from the translation set (plain es as fallback) — the
      // default-language fetch always carries the English one.
      const pTrans: Any[] = d.translations?.translations ?? [];
      const esT =
        pTrans.find((x) => x.iso_639_1 === "es" && x.iso_3166_1 === "ES") ??
        pTrans.find((x) => x.iso_639_1 === "es");
      return json(
        {
          person: {
            id: d.id,
            name: d.name ?? "",
            profile_path: d.profile_path ?? null,
            known_for_department: d.known_for_department ?? null,
            birthday: d.birthday ?? null,
            deathday: d.deathday ?? null,
            place_of_birth: d.place_of_birth ?? null,
            biography: d.biography || null,
            biography_es: esT?.data?.biography || null,
          },
          shows,
        },
        200,
        { "Cache-Control": "private, max-age=86400" },
      );
    }

    // GET /title/:id — cache-first. A cached title WITH season rows is served
    // straight from the DB; if it's stale it is still served now and
    // revalidated behind the response. Only a never-cached title — or one only
    // partially cached by search/discover, which never write seasons — blocks
    // on TMDB.
    const mTitle = path.match(/^\/title\/(\d+)$/);
    if (mTitle) {
      const tmdbId = Number(mTitle[1]);
      // ?refresh=1 forces a synchronous re-fetch from TMDB, bypassing the
      // freshness cache — used to backfill new derivations (e.g.
      // upcoming_season_number) across an already-cached library. Invite +
      // auth gated like every other route; refreshTitle is idempotent.
      if (url.searchParams.get("refresh") === "1") {
        const forced = await refreshTitle(admin, apiKey, tmdbId);
        return json(forced, 200, detailHeaders("MISS", 0));
      }
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
        .from("titles").select("id, last_refreshed_at, imdb_id").eq("tmdb_id", tmdbId).maybeSingle();
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
      // enrich=false: fillWholeShow runs the single TVmaze pass for this season
      // and every other one it brings in, right after.
      const filled = await refreshSeason(admin, apiKey, tmdbId, title.id, n, false);
      inBackground(fillWholeShow(admin, apiKey, tmdbId, title.id, filled.episodes.length > 0));
      return json(filled, 200, detailHeaders("MISS", dbMs, performance.now() - fillStarted));
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
});
