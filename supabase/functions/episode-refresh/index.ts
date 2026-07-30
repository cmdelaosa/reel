// episode-refresh — scheduled edge function (P2-C8).
//
// For every DISTINCT followed title (any user): refresh the title row (status,
// dates, scores) and the latest two regular seasons' episodes from TMDB,
// upserting diffs into the metadata cache. Titles refreshed < 20h ago are
// skipped, so a daily schedule self-heals without hammering TMDB. Rate-limited
// to ≤ 40 TMDB requests per 10s (fixed window — mirrors the unit-tested
// planner in app/src/domain/rateLimit.ts).
//
// AUTH: headless job — requires the service-role key as the bearer token.
//
// SCHEDULING (documented choice: pg_cron on hosted):
//   select cron.schedule('episode-refresh-daily', '0 5 * * *', $$
//     select net.http_post(
//       url    := 'https://<ref>.supabase.co/functions/v1/episode-refresh',
//       headers:= jsonb_build_object('Authorization', 'Bearer ' || <service key from vault>)
//     ) $$);
//   Locally: invoke manually — `supabase functions serve episode-refresh
//   --env-file supabase/.env` + curl with the local service key.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TMDB = "https://api.themoviedb.org/3";
const TVMAZE = "https://api.tvmaze.com";
const OMDB = "https://www.omdbapi.com"; // IMDb ratings, bridged via imdb_id
const AIR_TIME = "T21:00:00Z"; // placeholder; enrichAirTimes replaces it below
const STALE_MS = 20 * 60 * 60 * 1000; // 20h
const LIMIT = 40;
const WINDOW_MS = 10_000;

/* Every upstream call is capped. Without this a third party that accepts the
   connection but never answers hangs `await fetch` forever: the refresh loop's
   wall guard is only checked BETWEEN titles, so one stalled request freezes the
   whole run until the platform kills the invocation — which also loses the
   job_runs bookkeeping written after the loop (observed 2026-07-30: a forced
   backfill run stopped ~2.5 min in having refreshed 90 titles and never logged).
   A rejected fetch, by contrast, is already handled everywhere: TMDB throws and
   the per-title try/catch records it, TVmaze/OMDb degrade to a silent no-op.
   10s is generous for all three (p99 well under 1s) while keeping the worst-case
   per-title cost bounded — a handful of fetches, so tens of seconds, comfortably
   inside the margin the guard leaves. */
const UPSTREAM_TIMEOUT_MS = 10_000;

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

// -- fixed-window limiter (mirror of app/src/domain/rateLimit.ts) -------------
let winStart = 0;
let winUsed = 0;
async function throttle() {
  const now = Date.now();
  if (now - winStart >= WINDOW_MS) {
    winStart = now;
    winUsed = 1;
    return;
  }
  if (winUsed < LIMIT) {
    winUsed++;
    return;
  }
  const wait = winStart + WINDOW_MS - now;
  await new Promise((r) => setTimeout(r, wait));
  winStart += WINDOW_MS;
  winUsed = 1;
}

async function tmdb(key: string, path: string): Promise<Any> {
  await throttle();
  const res = await fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json();
}

const airDatetime = (d?: string | null) => (d ? `${d}${AIR_TIME}` : null);

// Cache each network's official TMDB logo_path by display name (best-effort);
// the client renders the brand image from it. Mirrors tmdb-proxy.
async function cacheNetworkLogos(admin: SupabaseClient, networks: Any) {
  const rows = ((networks ?? []) as Any[])
    .filter((n) => n?.name)
    .map((n) => ({ name: n.name as string, logo_path: n.logo_path ?? null, updated_at: new Date().toISOString() }));
  if (!rows.length) return;
  const { error } = await admin.from("network_logos").upsert(rows, { onConflict: "name" });
  if (error) console.error(`network_logos upsert: ${error.message}`);
}

// -- TVmaze air times (hand-mirror of tmdb-proxy's pair — keep in sync) -------
// TVmaze publishes ~20 requests per 10s and asks callers to stay under it. We
// spend at most two per title (a one-off id lookup, then the episode list), so
// a flat 250ms spacing keeps this job well inside the budget without needing
// the fixed-window planner TMDB gets.
const TVMAZE_GAP_MS = 250;
const tvmaze = async (path: string): Promise<Response> => {
  await new Promise((r) => setTimeout(r, TVMAZE_GAP_MS));
  return fetch(`${TVMAZE}${path}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
};

/** Air times already resolved from TVmaze, keyed `season x episode`.
 *
 *  The TMDB upsert writes every column in its payload, so without this it would
 *  stamp the 21:00 UTC placeholder over rows we had already dated properly —
 *  and the enrichment pass that follows is allowed to fail silently (TVmaze
 *  outage, rate limit, show dropped from their catalogue). That combination
 *  turns a momentary blip into real air times lost until the next successful
 *  run. Carrying the known values through the upsert keeps the placeholder for
 *  genuinely new episodes only.
 *
 *  Trade-off: if TMDB reschedules an episode while TVmaze is unreachable, we
 *  hold the older TVmaze instant rather than adopting a fresh placeholder. That
 *  is the better failure — the enrichment pass right below reconciles it as
 *  soon as TVmaze answers, and `air_time_source` stays an honest claim about
 *  where the value came from. */
async function keepTvmazeTimes(admin: SupabaseClient, titleId: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from("episodes")
    .select("season_number, episode_number, air_datetime")
    .eq("title_id", titleId)
    .eq("air_time_source", "tvmaze");
  const keep = new Map<string, string>();
  for (const e of (data ?? []) as Any[]) {
    if (e.air_datetime) keep.set(`${e.season_number}x${e.episode_number}`, e.air_datetime);
  }
  return keep;
}

/** TVmaze's show id, resolved via the IMDb id TMDB gives us (TVmaze indexes
 *  IMDb/TVDB, never TMDB) and cached on the row so it costs one request ever. */
async function tvmazeShowId(admin: SupabaseClient, title: Any): Promise<number | null> {
  if (title.tvmaze_id) return title.tvmaze_id;
  if (!title.imdb_id) return null;
  const res = await tvmaze(`/lookup/shows?imdb=${encodeURIComponent(title.imdb_id)}`);
  if (!res.ok) return null; // 404 → not in TVmaze's catalogue
  const id = (await res.json())?.id ?? null;
  if (id) await admin.from("titles").update({ tvmaze_id: id }).eq("id", title.id);
  return id;
}

/** Replace this title's 21:00 UTC placeholders with TVmaze's real airstamps.
 *  Best-effort: a miss leaves the estimates and their marker untouched. */
async function enrichAirTimes(admin: SupabaseClient, titleId: string) {
  const { data: title } = await admin
    .from("titles").select("id, imdb_id, tvmaze_id").eq("id", titleId).maybeSingle();
  if (!title) return;

  const showId = await tvmazeShowId(admin, title);
  if (!showId) return;

  const res = await tvmaze(`/shows/${showId}/episodes`);
  if (!res.ok) return;
  const stamps = new Map<string, string>();
  for (const e of (await res.json()) as Any[]) {
    if (e?.airstamp && e.season != null && e.number != null) {
      stamps.set(`${e.season}x${e.number}`, new Date(e.airstamp).toISOString());
    }
  }
  if (!stamps.size) return;

  const { data: ours } = await admin
    .from("episodes")
    .select("title_id, season_number, episode_number, air_datetime, air_time_source")
    .eq("title_id", titleId)
    .gt("season_number", 0);

  const rows = (ours ?? [])
    .map((e: Any) => ({ e, at: stamps.get(`${e.season_number}x${e.episode_number}`) }))
    // Instants, not strings: Postgres renders timestamptz with +00:00 where
    // toISOString() writes Z, so a textual diff would rewrite everything daily.
    .filter((x) =>
      x.at &&
      (x.e.air_time_source !== "tvmaze" ||
        new Date(x.e.air_datetime ?? 0).getTime() !== new Date(x.at).getTime()))
    .map((x) => ({
      title_id: x.e.title_id,
      season_number: x.e.season_number,
      episode_number: x.e.episode_number,
      air_datetime: x.at,
      air_time_source: "tvmaze",
    }));
  if (!rows.length) return;

  const { error } = await admin
    .from("episodes").upsert(rows, { onConflict: "title_id,season_number,episode_number" });
  if (error) console.error(`tvmaze air times: ${error.message}`);
}

// -- IMDb ratings via OMDb (hand-mirror of tmdb-proxy's pair — keep in sync) --
// TMDB carries no IMDb rating; we bridge through the imdb_id it gives us (0051)
// to OMDb, which mirrors IMDb's score. OMDb has no documented burst limit beyond
// its daily quota, but we pace it with a flat gap like TVmaze above. Best-effort
// and idempotent: no key, no imdb_id, or an OMDb miss is a silent no-op.
const OMDB_GAP_MS = 120;
const omdbFetch = async (apiKey: string, params: string): Promise<Any | null> => {
  await new Promise((r) => setTimeout(r, OMDB_GAP_MS));
  // Capped like every upstream call (see UPSTREAM_TIMEOUT_MS). The timeout
  // rejects, which the catch turns into null — the same no-op as an OMDb miss.
  const res = await fetch(`${OMDB}/?apikey=${apiKey}&${params}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = await res.json().catch(() => null);
  // OMDb answers 200 with { Response: "False" } for misses and quota hits.
  return d && d.Response !== "False" ? d : null;
};

// OMDb ships numbers as strings ("9.2", "1,234,567") or the sentinel "N/A".
const parseImdbRating = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const parseImdbVotes = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const n = Number.parseInt(v.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/** Refresh the show's IMDb rating and the given seasons' per-episode ratings
 *  from OMDb. `seasons` are the numbers we just pulled from TMDB (the latest
 *  two), so the graph's newest data stays current without re-fetching a show's
 *  whole back catalogue every night. Only writes real scores — both the show
 *  and each episode — so a transient/lagging "N/A" never wipes a good value. */
async function enrichImdb(admin: SupabaseClient, titleId: string, imdbId: string | null, seasons: number[]) {
  const apiKey = Deno.env.get("OMDB_API_KEY");
  if (!apiKey || !imdbId) return;

  const show = await omdbFetch(apiKey, `i=${encodeURIComponent(imdbId)}`);
  const rating = parseImdbRating(show?.imdbRating);
  if (rating != null) {
    await admin.from("titles")
      .update({ imdb_rating: rating, imdb_votes: parseImdbVotes(show?.imdbVotes) })
      .eq("id", titleId);
  }

  for (const n of seasons) {
    const d = await omdbFetch(apiKey, `i=${encodeURIComponent(imdbId)}&Season=${n}`);
    const eps = (d?.Episodes ?? []) as Any[];
    if (!eps.length) continue;
    const byNum = new Map<number, { rating: number | null; imdbId: string | null }>();
    for (const e of eps) {
      const num = Number.parseInt(e?.Episode, 10);
      if (Number.isFinite(num)) byNum.set(num, { rating: parseImdbRating(e?.imdbRating), imdbId: e?.imdbID ?? null });
    }
    const { data: ours } = await admin
      .from("episodes").select("title_id, season_number, episode_number")
      .eq("title_id", titleId).eq("season_number", n);
    const rows = (ours ?? [])
      .map((e: Any) => ({ e, m: byNum.get(e.episode_number) }))
      // Only rated episodes: an "N/A" listing must not null out a stored rating.
      .filter((x) => x.m && x.m.rating != null)
      .map((x) => ({
        title_id: x.e.title_id,
        season_number: x.e.season_number,
        episode_number: x.e.episode_number,
        imdb_rating: x.m!.rating,
        imdb_id: x.m!.imdbId,
      }));
    if (rows.length) {
      const { error } = await admin.from("episodes")
        .upsert(rows, { onConflict: "title_id,season_number,episode_number" });
      if (error) console.error(`imdb season ratings: ${error.message}`);
    }
  }
}

// es-ES translation (plain es fallback) from a payload fetched with
// append_to_response=translations. Mirrors tmdb-proxy.
function esTranslation(d: Any): { name: string | null; overview: string | null } {
  const all: Any[] = d?.translations?.translations ?? [];
  const t =
    all.find((x) => x.iso_639_1 === "es" && x.iso_3166_1 === "ES") ??
    all.find((x) => x.iso_639_1 === "es");
  return { name: t?.data?.name || null, overview: t?.data?.overview || null };
}

// One spelling per brand across the column, the logo cache and the UI, and the
// ad-supported tiers folded into their parent. Hand-mirrors
// app/src/domain/watchProviders.ts (the spec + tests), same as tmdb-proxy.
const PROVIDER_ALIASES: Record<string, string> = {
  "Amazon Prime Video": "Prime Video",
  "Disney Plus": "Disney+",
  "Apple TV Plus": "Apple TV+",
  // TMDB renamed the subscription service to plain "Apple TV" (the rent/buy
  // storefront is "Apple TV Store"), and we only read subscription buckets.
  "Apple TV": "Apple TV+",
};

const RESELLER = /\s+(amazon|apple tv|roku)\s+channel$/i;
// The tier word is optional: TMDB ships a bare "Amazon Prime Video with Ads".
const AD_TIER = /\s+(basic\s+|standard\s+)?with\s+ads$/i;

function canonicalProvider(name: string): string {
  const base = name.replace(RESELLER, "").replace(AD_TIER, "").trim();
  return PROVIDER_ALIASES[base] ?? base;
}

/** TMDB watch/providers → {ES: [{name, logo_path}], …}. Mirrors tmdb-proxy:
 *  subscription-shaped buckets only (rent/buy would put Apple TV and Google
 *  Play on half the library), every country in one column, TMDB's own order. */
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
        const name = canonicalProvider(p.provider_name as string);
        const art = (p.logo_path ?? null) as string | null;
        if (seen.has(name) || (art && seenArt.has(art))) continue;
        seen.add(name);
        if (art) seenArt.add(art);
        list.push({ name, logo_path: art });
      }
    }
    // Drop an entry that merely extends another in the same country: Spain
    // returns "Movistar Plus+" and "Movistar Plus+ Ficción Total" for one show,
    // near-identical icons under different file names. Parent wins whatever
    // the order; an add-on listed alone keeps its own name.
    const merged = list.filter((a) => !list.some((b) => b !== a && a.name.startsWith(`${b.name} `)));
    if (merged.length) out[country] = merged;
  }
  return out;
}

/** `allImdbSeasons` widens the IMDb pass from the latest two seasons to every
 *  regular season. Off by default — the daily cron only needs the seasons that
 *  can still change. On for the one-off backfill: a show's OLDER seasons are the
 *  finished ones, where the episode graph is most worth having, and they were
 *  otherwise left to fill in only when someone happened to open them (measured
 *  on 2026-07-30: 1048 of 1851 seasons had no IMDb rating at all). Costs one OMDb
 *  request per extra season — nothing against the paid tier's 100k/day. */
async function refreshTitle(
  admin: SupabaseClient,
  key: string,
  row: { id: string; tmdb_id: number },
  allImdbSeasons = false,
) {
  const d = await tmdb(key, `/tv/${row.tmdb_id}?append_to_response=translations,external_ids,watch/providers`);
  const es = esTranslation(d);
  const providers = providerMap(d);
  const { error: te } = await admin
    .from("titles")
    .update({
      name: d.name ?? "Untitled",
      original_name: d.original_name ?? null,
      name_es: es.name,
      overview_es: es.overview,
      overview: d.overview ?? null,
      poster_path: d.poster_path ?? null,
      backdrop_path: d.backdrop_path ?? null,
      first_air_date: d.first_air_date || null,
      status: d.status ?? null,
      imdb_id: d.external_ids?.imdb_id || null, // bridge to TVmaze
      genres: (d.genres ?? []).map((g: Any) => g.name),
      network: d.networks?.[0]?.name ?? null,
      // Omitted, not nulled, when TMDB returned none — a title we hold
      // providers for shouldn't lose them to a payload that skipped the append.
      ...(providers ? { providers } : {}),
      episode_run_time: d.episode_run_time?.[0] ?? null,
      vote_average: d.vote_average ?? null,
      popularity: d.popularity ?? null,
      aired_count: airedCount(d.seasons, d.last_episode_to_air),
      upcoming_season_number: upcomingSeason(d.seasons, d.last_episode_to_air, d.next_episode_to_air)?.number ?? null,
      upcoming_season_air_date: upcomingSeason(d.seasons, d.last_episode_to_air, d.next_episode_to_air)?.air_date ?? null,
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (te) throw new Error(`title update: ${te.message}`);

  await cacheNetworkLogos(admin, d.networks);

  const regular = (d.seasons ?? [])
    .filter((s: Any) => (s.season_number as number) > 0)
    .sort((a: Any, b: Any) => b.season_number - a.season_number);
  // TMDB episode refresh stays on the latest two seasons — that's where episodes
  // and air times still move, and it's the expensive half (a request per season
  // plus the upserts). The IMDb pass can be widened independently: it's one
  // request per season and older seasons are exactly the settled ones.
  const latest = regular.slice(0, 2);

  // Read once for the whole title, before any episode write touches it.
  const keep = await keepTvmazeTimes(admin, row.id);

  for (const s of latest) {
    const { data: season, error: se } = await admin
      .from("seasons")
      .upsert(
        {
          title_id: row.id,
          tmdb_id: s.id ?? null,
          number: s.season_number,
          name: s.name ?? null,
          episode_count: s.episode_count ?? null,
          air_date: s.air_date || null,
        },
        { onConflict: "title_id,number" },
      )
      .select("id")
      .single();
    if (se || !season) throw new Error(`season upsert: ${se?.message}`);

    const sd = await tmdb(key, `/tv/${row.tmdb_id}/season/${s.season_number}`);
    const eps = (sd.episodes ?? []).map((e: Any) => {
      // Never downgrade an air time we already know; only new episodes get the
      // placeholder. Value and provenance move together, always.
      const known = keep.get(`${e.season_number}x${e.episode_number}`);
      return {
        title_id: row.id,
        season_id: season.id,
        tmdb_id: e.id ?? null,
        season_number: e.season_number,
        episode_number: e.episode_number,
        name: e.name ?? null,
        overview: e.overview ?? null,
        runtime: e.runtime ?? null,
        // Per-episode TMDB score — free, already in this payload; the second
        // source behind the episode graph. IMDb ratings come via OMDb below.
        tmdb_vote_average: e.vote_average ?? null,
        tmdb_vote_count: e.vote_count ?? null,
        air_datetime: known ?? airDatetime(e.air_date),
        air_time_source: known ? "tvmaze" : "estimated",
      };
    });
    if (eps.length) {
      const { error: ee } = await admin
        .from("episodes")
        .upsert(eps, { onConflict: "title_id,season_number,episode_number" });
      if (ee) throw new Error(`episodes upsert: ${ee.message}`);
    }
  }

  // After the TMDB placeholders are in, overwrite the ones TVmaze can date
  // properly. Inline (not detached) so the run's rate limiting still applies
  // and a slow TVmaze can't outlive the invocation. Never fatal: a failure
  // here must not cost us the TMDB refresh we just did.
  try {
    await enrichAirTimes(admin, row.id);
  } catch (err) {
    console.error(`tvmaze enrich ${row.tmdb_id}: ${String(err)}`);
  }

  // IMDb ratings (show + the seasons we just refreshed). Same contract as the
  // TVmaze pass: inline so the run's pacing applies, never fatal to the TMDB
  // refresh we just did. `latest` is the newest ≤2 regular seasons.
  try {
    await enrichImdb(
      admin,
      row.id,
      d.external_ids?.imdb_id || null,
      (allImdbSeasons ? regular : latest).map((s: Any) => s.season_number),
    );
  } catch (err) {
    console.error(`imdb enrich ${row.tmdb_id}: ${String(err)}`);
  }
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const tmdbKey = Deno.env.get("TMDB_API_KEY");
  if (!tmdbKey) {
    return new Response(JSON.stringify({ error: "TMDB_API_KEY not configured" }), { status: 500 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Opt-in full refresh (manual runs only): bypass the staleness gate so every
  // followed title is recomputed now — used to backfill after a derivation
  // change (e.g. upcoming_season_number). The daily cron omits it and keeps
  // respecting staleness to stay within the TMDB budget.
  const params = new URL(req.url).searchParams;
  const force = params.get("force") === "1";
  // Opt-in (manual runs only): enrich EVERY season's IMDb ratings, not just the
  // latest two. See refreshTitle's allImdbSeasons — this is the flag the one-off
  // IMDb backfill uses so finished seasons get their episode graph without
  // waiting for someone to open them.
  const allImdbSeasons = params.get("imdbSeasons") === "all";

  // One queryable row per run/exit (job_runs, migration 0029) so a silently-
  // failing daily job is visible (edge logs are console-only + ~1 day on free
  // tier). Best-effort — never fail the run on the log write.
  const startedAt = new Date().toISOString();
  const logRun = (ok: boolean, summary: unknown) =>
    admin.from("job_runs").insert({
      job: "episode-refresh",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok,
      summary,
    }).then(() => {}, () => {});

  // distinct followed titles (service role sees all users). The !inner embed
  // filters titles to those with ≥1 followed entry — parent rows stay unique,
  // and no giant `.in(id, …)` URI is needed. Ordered oldest-refreshed first so
  // the wall guard becomes a rotating window (no title starves), and paged past
  // PostgREST's 1000-row cap so the whole followed set is considered. `id` is
  // the tiebreaker: last_refreshed_at ties exactly across the never-refreshed
  // (NULL) cohort, and untied pages can skip/duplicate rows across boundaries.
  const PAGE = 1000;
  const titles: Any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: te } = await admin
      .from("titles")
      .select("id, tmdb_id, status, last_refreshed_at, library_entries!inner(followed)")
      .eq("library_entries.followed", true)
      .order("last_refreshed_at", { ascending: true, nullsFirst: true })
      .order("id")
      .range(from, from + PAGE - 1);
    if (te) {
      await logRun(false, { error: te.message });
      return new Response(JSON.stringify({ error: te.message }), { status: 500 });
    }
    titles.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const ids = titles.map((t: Any) => t.id);

  // Ended/Canceled shows never gain episodes, so touch them at most monthly
  // instead of every daily run — that removes the bulk of a mature library's
  // TMDB calls and keeps the daily budget for shows that actually change.
  const now = Date.now();
  const ENDED_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30d
  const isDone = (s: string | null) => s === "Ended" || s === "Canceled";
  const stale = force ? titles : titles.filter((t: Any) => {
    const age = t.last_refreshed_at ? now - new Date(t.last_refreshed_at).getTime() : Infinity;
    return age > (isDone(t.status) ? ENDED_STALE_MS : STALE_MS);
  });

  // Respond immediately and refresh in the background (EdgeRuntime.waitUntil)
  // so the gateway's request timeout never truncates a big backfill. A wall
  // guard stops before the runtime's hard limit; leftovers stay stale and the
  // next scheduled run picks them up (refreshTitle is idempotent).
  //
  // 300s, down from 330s: the guard is only consulted between titles, so the
  // margin it leaves has to cover one whole title's worst case. Since IMDb
  // enrichment joined the per-title work that worst case grew (more upstream
  // calls), and a run really did get killed mid-title without logging. Capping
  // every fetch (UPSTREAM_TIMEOUT_MS) bounds a title; this widens the margin
  // that bound has to fit inside. Costs ~30s of throughput per run — the
  // leftovers are picked up by the next one either way.
  const MAX_MS = 300_000;
  const started = Date.now();

  const work = (async () => {
    let refreshed = 0;
    let hitGuard = false;
    const errors: string[] = [];
    for (const t of stale) {
      if (Date.now() - started > MAX_MS) { hitGuard = true; break; }
      try {
        await refreshTitle(admin, tmdbKey, t, allImdbSeasons);
        refreshed++;
      } catch (err) {
        errors.push(`${t.tmdb_id}: ${String(err)}`);
      }
    }
    console.log(
      `episode-refresh done: ${refreshed}/${stale.length} refreshed, ${errors.length} errors` +
        (hitGuard ? ` (stopped at the ${MAX_MS / 1000}s guard)` : ""),
      errors.slice(0, 5),
    );
    // hitGuard distinguishes "worked through the whole list" from "ran out of
    // time with N left" — without it a truncated backfill and a complete run
    // look identical in job_runs, which is the only place these runs are
    // visible once the edge logs age out.
    await logRun(errors.length === 0, {
      followed: ids.length,
      stale: stale.length,
      refreshed,
      errors: errors.length,
      hitGuard,
      remaining: hitGuard ? stale.length - refreshed - errors.length : 0,
      // Which mode produced these numbers: an all-seasons IMDb run covers far
      // fewer titles per invocation, so without this the counts look alarming.
      allImdbSeasons,
      sample: errors.slice(0, 5),
    });
  })();

  // Respond immediately and let the backfill run in the background where the
  // runtime supports it; otherwise await inline. (waitUntil() returns void, so
  // `?? await` would always run inline — must branch explicitly.)
  // deno-lint-ignore no-explicit-any
  const edge = (globalThis as Any).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
  else await work;

  return new Response(
    JSON.stringify({
      followedTitles: ids.length,
      stale: stale.length,
      skipped: titles.length - stale.length,
      processing: stale.length > 0,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
