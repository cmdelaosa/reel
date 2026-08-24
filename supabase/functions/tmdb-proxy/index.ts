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
//   GET /movie/search?q=           → { results: TitleRow[] }
//   GET /movie/trending            → { results: TitleRow[] }
//   GET /movie/now-playing?region= → { results: TitleRow[] }
//   GET /movie/popular?from=&to=   → { results: TitleRow[] }
//   GET /movie/top-rated?from=&to=&genres= → { results: TitleRow[] }
//   GET /movie/:tmdbId             → { title: TitleRow, episode_id: uuid|null }
//   GET /movie/:tmdbId/credits     → { cast: […], crew: […] }
//   GET /movie/:tmdbId/saga        → { collection, parts: TitleRow[] }
//   POST /warm                     → { ok, summary }  (service-role cron only)
//
// Series y películas comparten la tabla `titles` y se distinguen por `kind`.
// Un id de TMDB solo es único DENTRO de su medio (/tv/1399 y /movie/1399 son
// cosas distintas), así que desde 0067 la identidad de un título es la pareja
// (kind, tmdb_id) — de ahí el onConflict y los .eq("kind", …) de todo el
// fichero. Quitar cualquiera de los dos hace que una película pise una serie.
//
// Every response is served from the metadata cache (rows written with the
// service-role key) — the client never sees raw TMDB payloads. /title and
// /season are cache-first: fresh rows skip TMDB entirely, stale rows are served
// immediately and revalidated in the background, and only never-cached data
// blocks on a TMDB fetch. "Fresh" means < 24h, off two separate marks —
// last_refreshed_at for /title's detail, episodes_refreshed_at for /season's
// episodes — because the discovery warm-up writes the first without the second
// (migration 0066). A valid
// *user* JWT is required (the anon key alone is rejected). The response shape is
// mirrored (minimally, no cross-runtime import) by app/src/lib/schemas.ts.
//
// The four discovery routes each cache the ORDER they resolved to (24h) rather
// than re-deriving it per request — see the "discovery caches" block. /warm
// rebuilds all four on a schedule so no reader ever pays for a cold one.
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

/* Which instant an episode is released, and who gets to say so: a broadcaster's
   own clock from TVmaze, else the platform's standing release rule, else the
   placeholder. TMDB's day is still the anchor, and only a platform rule under
   three locks may move it (0065). Hand-mirror of app/src/domain/airPairing.ts
   (canonical spec + unit tests + a source-vs-source mirror test); the block
   below is compared verbatim, so edit it there. */
// ── air-time pairing ─────────────────────────────────────────────────────────
// Spec + tests: app/src/domain/airPairing.ts — keep the three copies identical.

/** The 21:00 UTC placeholder stapled onto TMDB's bare day. Correct to the day
 *  from UTC-3 to UTC+2 and a day out in Asia-Pacific; the UI prints no clock
 *  for these rows (hasRealAirTime), so the hour is never shown, only used to
 *  order the calendar and decide what has aired. */
export const AIR_TIME = "T21:00:00Z";

/** When a platform releases, as a wall clock in its own zone — the form the
 *  streamers themselves announce ("midnight PT"), and the only form that
 *  survives DST without a table of exceptions.
 *
 *  Keyed by a platform's display name, from either titles.network or
 *  titles.providers — see rulePlatform.
 *  Deliberately short: Hulu, Peacock, HBO Max and SkyShowtime all carry titles
 *  in this library and none is here, because no source we have states when they
 *  drop, and an invented hour presented as fact is the bug this file exists to
 *  prevent. Those titles keep the placeholder and the UI shows the day alone.
 *  Broadcasters are absent on purpose — TVmaze knows their schedule, and a real
 *  `airtime` always wins over anything here.
 *
 *  `days` are the weekdays (0 = Sunday) a platform releases on, and only Apple
 *  needs them: it is the one streamer whose TMDB dates are filed in a zone far
 *  enough west to fall on the previous day. See releaseDay. */
export interface PlatformRelease {
  at: string;
  tz: string;
  days?: readonly number[];
}

export const PLATFORM_RELEASE: Readonly<Record<string, PlatformRelease>> = {
  // 21:00 PT the evening before, which is this, and is why `days` is here.
  "Apple TV": { at: "00:00", tz: "America/New_York", days: [3, 5] },
  "Apple TV+": { at: "00:00", tz: "America/New_York", days: [3, 5] },
  Netflix: { at: "00:00", tz: "America/Los_Angeles" },
  "Disney+": { at: "00:00", tz: "America/Los_Angeles" },
  "Prime Video": { at: "00:00", tz: "America/Los_Angeles" },
  "Amazon Prime Video": { at: "00:00", tz: "America/Los_Angeles" },
};

export const platformRelease = (name: string | null | undefined): PlatformRelease | null =>
  (name && PLATFORM_RELEASE[name]) || null;

/** Countries whose provider list fills in for a network with no rule, in order.
 *
 *  ES first because it is the market every viewer here watches from (the app's
 *  FALLBACK_COUNTRY, and no profile has ever set another), so when a show runs
 *  on different services either side of the Atlantic, the Spanish one decides.
 *  US second for the reach: a title absent from Spain often still resolves
 *  there, and every rule in the table above is a worldwide simultaneous drop,
 *  so borrowing the American service's clock does not move the instant. */
export const PROVIDER_COUNTRIES = ["ES", "US"] as const;

/** Where a title can be watched, as titles.providers holds it. */
export interface PlatformSource {
  providers?: Record<string, { name?: string | null }[] | null | undefined> | null;
  network?: string | null;
}

/** The platform whose release rule dates this title: the network if it has one,
 *  else the first provider that does.
 *
 *  `network` alone was the whole lookup, and it is where TMDB files the
 *  ORIGINAL BROADCASTER — for a streaming show either wrong or archaeology.
 *  Adults is filed under FX and Futurama under FOX; both stream on Disney+ in
 *  Spain and Hulu in the States, and neither got a clock though a rule for
 *  their real platform sat in the table above. So providers answer for the
 *  titles the network cannot.
 *
 *  They answer SECOND, and that order was arrived at the hard way. A provider
 *  list is ordered by TMDB's display_priority — commercial prominence, not who
 *  releases the thing: in Spain both Ted Lasso and Silo list "Prime Video"
 *  ahead of "Apple TV+", because Apple sells itself as a channel inside Prime.
 *  Reading providers first pulled two Apple originals off Apple's own
 *  convention (midnight ET, day-shifted) and onto midnight Pacific. When the
 *  network IS a streamer we have a rule for, it stays the best evidence about
 *  who releases it.
 *
 *  And it takes the first name WITH A RULE, not the first name: a Spanish list
 *  often opens with Movistar Plus+, and stopping there would drop a title the
 *  next entry could have dated. Between the two, the lookup is purely additive
 *  — a title that had a clock keeps exactly the one it had. */
export function rulePlatform(title: PlatformSource): string | null {
  const names: (string | null | undefined)[] = [title.network];
  for (const country of PROVIDER_COUNTRIES) {
    for (const p of title.providers?.[country] ?? []) names.push(p?.name);
  }
  return names.find((name) => platformRelease(name)) ?? null;
}

/** One episode as TVmaze publishes it. `airdate` is the broadcaster's local
 *  day — the field we pair on; `airstamp` is the absolute instant we store;
 *  `airtime` is empty for everything that isn't scheduled broadcast, and is the
 *  only proof that the stamp beside it means anything. */
export interface TvmazeEpisode {
  season?: number | null;
  number?: number | null;
  airdate?: string | null;
  airtime?: string | null;
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

export type AirTimeSource = "tvmaze" | "platform" | "estimated";

export interface AirTime {
  air_datetime: string;
  air_time_source: AirTimeSource;
}

/** TVmaze's episodes under every key the pairing needs: the number it claims,
 *  the day it actually aired, and how many it carries per season — the last one
 *  only so alignedSeasons can compare catalogue sizes. */
export interface TvmazeIndex {
  byNumber: Map<string, TvmazeEpisode>;
  byDate: Map<string, TvmazeEpisode[]>;
  perSeason: Map<number, number>;
  size: number;
}

export function indexTvmaze(eps: readonly TvmazeEpisode[] | null | undefined): TvmazeIndex {
  const byNumber = new Map<string, TvmazeEpisode>();
  const byDate = new Map<string, TvmazeEpisode[]>();
  const perSeason = new Map<number, number>();
  for (const e of eps ?? []) {
    // Specials are out of scope on both sides of the comparison, the way every
    // gate in the app filters season_number > 0. Entries with no stamp carry
    // neither a day nor an hour worth pairing on.
    if (!e?.airstamp || e.season == null || e.number == null || e.season <= 0) continue;
    byNumber.set(`${e.season}x${e.number}`, e);
    perSeason.set(e.season, (perSeason.get(e.season) ?? 0) + 1);
    if (e.airdate) {
      const sameDay = byDate.get(e.airdate);
      if (sameDay) sameDay.push(e);
      else byDate.set(e.airdate, [e]);
    }
  }
  return { byNumber, byDate, perSeason, size: byNumber.size };
}

const MS_DAY = 86_400_000;
const asUtcDay = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`);
const addDays = (ymd: string, n: number): string =>
  new Date(asUtcDay(ymd) + n * MS_DAY).toISOString().slice(0, 10);
/** 0 = Sunday. Read in UTC because a bare date has no zone to read it in. */
const weekday = (ymd: string): number => new Date(asUtcDay(ymd)).getUTCDay();

/** How far a zone was from UTC at a given instant, in ms — positive west of
 *  Greenwich, i.e. the amount to ADD to a wall clock to get back to UTC. */
function zoneOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const f: Record<string, string> = {};
  for (const p of parts) f[p.type] = p.value;
  const local = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
  return instant - local;
}

/** The instant at which `tz` read `ymd` at `at` on its own clock.
 *
 *  A zone offset is only defined for an instant, and we start from a wall clock,
 *  so it takes two passes: the first lands within an hour of the answer, which
 *  is close enough for the second to be reading the right side of any DST
 *  change. Both are needed — one pass alone is off by an hour twice a year, and
 *  an hour is a day for anything released at midnight. */
function zonedInstant(ymd: string, at: string, tz: string): string {
  const wall = Date.parse(`${ymd}T${at}:00Z`);
  const once = wall + zoneOffsetMs(wall, tz);
  return new Date(wall + zoneOffsetMs(once, tz)).toISOString();
}

/** The TVmaze episode that can speak for one of ours, or null.
 *
 *  Two ways to match, in order. The same season × number, WHEN it agrees with
 *  TMDB's day — the ordinary case, and the cheap one. Failing that, the single
 *  episode TVmaze aired on that day, whatever number it wears: this is what
 *  re-aligns a catalogue counting episodes differently. `single` is the whole
 *  safety of the fallback — a day carrying two or more episodes (a double bill,
 *  a season dumped at once) can't be resolved by date, so it gets no clock
 *  rather than a coin flip. */
function paired(ep: AnchoredEpisode, idx: TvmazeIndex): TvmazeEpisode | null {
  const sameNumber = idx.byNumber.get(`${ep.season_number}x${ep.episode_number}`);
  if (sameNumber && sameNumber.airdate === ep.air_date) return sameNumber;
  const sameDay = idx.byDate.get(ep.air_date!) ?? [];
  return sameDay.length === 1 ? sameDay[0] : null;
}

/** The seasons where TVmaze's day may override TMDB's.
 *
 *  Three locks, and the middle one is the load-bearing one: TVmaze must carry
 *  exactly as many episodes of that season as we do. A catalogue that counts
 *  differently is precisely the Hot Ones failure — thirteen against eleven —
 *  and every mis-stamped row there came from pairing across that gap. Then no
 *  episode may be more than a day off (a weekly drift is seven), and each must
 *  pair by its own number, so nothing here re-derives what `paired` already
 *  refuses.
 *
 *  Callers pass every episode of the title; seasons absent from either side
 *  simply never make the set, which leaves them on TMDB's day. */
export function alignedSeasons(
  ours: readonly AnchoredEpisode[],
  idx: TvmazeIndex,
): Set<number> {
  const mine = new Map<number, AnchoredEpisode[]>();
  for (const e of ours) {
    if (e.season_number <= 0 || !e.air_date) continue;
    const held = mine.get(e.season_number);
    if (held) held.push(e);
    else mine.set(e.season_number, [e]);
  }
  const aligned = new Set<number>();
  for (const [season, eps] of mine) {
    if (eps.length !== (idx.perSeason.get(season) ?? 0)) continue;
    const everyOneClose = eps.every((e) => {
      const theirs = idx.byNumber.get(`${season}x${e.episode_number}`);
      if (!theirs?.airdate) return false;
      const off = (asUtcDay(theirs.airdate) - asUtcDay(e.air_date!)) / MS_DAY;
      return off === 0 || off === 1;
    });
    if (everyOneClose) aligned.add(season);
  }
  return aligned;
}

/** What the caller knows about the title beyond its episodes: which platform
 *  it streams on (TMDB's network name), and which of its seasons TVmaze is
 *  trusted to re-date (alignedSeasons). Both optional — without them the rule
 *  degrades to what it was before 0065. */
export interface AirContext {
  platform?: string | null;
  realign?: ReadonlySet<number>;
}

/** The day the platform actually released this episode.
 *
 *  TVmaze's, when the season passed alignedSeasons and TVmaze places the
 *  episode under our own number: direct evidence beats inference. Otherwise the
 *  weekday tells us — a date the platform never releases on, one day before a
 *  date it does, is the Pacific evening before that release. Anything else is
 *  taken at face value. */
function releaseDay(
  ep: AnchoredEpisode,
  idx: TvmazeIndex,
  rule: PlatformRelease,
  realign: ReadonlySet<number> | undefined,
): string {
  const theirs = idx.byNumber.get(`${ep.season_number}x${ep.episode_number}`);
  if (realign?.has(ep.season_number) && theirs?.airdate) return theirs.airdate;
  const next = addDays(ep.air_date!, 1);
  if (rule.days && !rule.days.includes(weekday(ep.air_date!)) && rule.days.includes(weekday(next))) {
    return next;
  }
  return ep.air_date!;
}

/** The air time a row should hold, given TMDB's day, what TVmaze published and
 *  which platform it streams on. Three sources, in descending order of proof:
 *
 *   - `tvmaze`   — a scheduled broadcaster's own clock. Only when `airtime` is
 *                  set: the bare `airstamp` of a streaming title is TVmaze's
 *                  noon-UTC filler, and printing it was how Stranger Things
 *                  claimed to arrive at 14:00.
 *   - `platform` — the streamer's standing release time, resolved in its own
 *                  zone on the day it really releases (releaseDay).
 *   - `estimated`— the 21:00 UTC placeholder, which the UI prints no clock for.
 *
 *  null means "leave this row alone": without an anchor there is nothing to
 *  judge a stamp against, and guessing is how the rows got wrong in the first
 *  place.
 *
 *  Otherwise the answer is total, and that matters — a row TVmaze can no longer
 *  account for is re-derived from scratch rather than keeping an instant nothing
 *  supports any more. That is what repairs the episodes the old number-only
 *  pairing mis-stamped. Callers must therefore not hand an empty index to a row
 *  already sourced from `tvmaze`: an outage that returned nothing would
 *  otherwise demote a whole broadcaster's calendar. */
export function resolveAirTime(
  ep: AnchoredEpisode,
  idx: TvmazeIndex,
  ctx: AirContext = {},
): AirTime | null {
  if (!ep.air_date) return null;
  const onDay = paired(ep, idx);
  if (onDay?.airtime && onDay.airstamp) {
    return { air_datetime: new Date(onDay.airstamp).toISOString(), air_time_source: "tvmaze" };
  }
  const rule = platformRelease(ctx.platform);
  if (rule) {
    const day = releaseDay(ep, idx, rule, ctx.realign);
    return { air_datetime: zonedInstant(day, rule.at, rule.tz), air_time_source: "platform" };
  }
  return { air_datetime: `${ep.air_date}${AIR_TIME}`, air_time_source: "estimated" };
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

// TMDB MOVIE genre ids → names. A separate space from the TV one above, and
// only partly overlapping: 18 is Drama in both, but 10759 (TV's Action &
// Adventure) doesn't exist for film, which splits it into 28 and 12. Reading a
// movie's ids through TV_GENRES silently drops the ones that don't collide and
// mislabels nothing — which is worse, because it looks like it worked.
const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
  37: "Western",
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
//
// `name` for a series, `title` for a film: TMDB carries the localized name
// under a different key per medium, and reading only the first one left every
// Spanish film title null while looking like it had simply not been translated.
function esTranslation(d: Any): { name: string | null; overview: string | null } {
  const all: Any[] = d?.translations?.translations ?? [];
  const t =
    all.find((x) => x.iso_639_1 === "es" && x.iso_3166_1 === "ES") ??
    all.find((x) => x.iso_639_1 === "es");
  return { name: t?.data?.name || t?.data?.title || null, overview: t?.data?.overview || null };
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
    // The DETAIL stamp, and only that: this row came from a full /tv/:id fetch,
    // so it is true wherever titleRow is used — including the popular-now
    // warm-up, which holds full details too. `episodes_refreshed_at` is
    // conspicuously absent and must stay that way: not one episode is written
    // anywhere near here, and a payload that claimed otherwise would put the
    // nightly cron back to skipping every followed title in the pool.
    last_refreshed_at: new Date().toISOString(),
  };
}

// Search results are partial: only genre_ids (mapped) and no network/status/
// runtime — so we omit those columns to avoid clobbering richer detail rows on
// conflict (PostgREST upsert only updates the columns present in the payload).
// last_refreshed_at is also omitted: it marks a *full detail* refresh (the
// cache-first /title path keys off it), and a search hit must not make a title
// look fresher than its detail data is.
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

/* ── películas ───────────────────────────────────────────────────────────────
   Las dos filas de arriba tienen su gemela para cine. Las columnas son las
   mismas — `titles` es una tabla para los dos medios desde 0002 — y solo cambia
   de dónde sale cada una:

     first_air_date  ← release_date   (el estreno; para una serie, el del piloto)
     episode_run_time ← runtime       (la duración de la película, en minutos)
     network         ← el estudio     (production_companies[0], que es lo más
                                       parecido a "de quién es esto")
     status          ← "Released" | "Post Production" | "Planned" | …

   `aired_count` se queda deliberadamente SIN escribir: en una serie lo calcula
   TMDB desde sus temporadas, y en una película el recuento sale del episodio
   sintético que mantiene el trigger de 0067 — que ya sabe si la fecha de
   estreno pasó. Escribir un 1 aquí diría que una película de 2027 ya se
   estrenó. */

function movieRow(d: Any) {
  const providers = providerMap(d);
  const releaseDates = releaseDateMap(d);
  const es = d.translations ? esTranslation(d) : null;
  return {
    tmdb_id: d.id,
    kind: "movie",
    name: d.title ?? d.original_title ?? "Untitled",
    original_name: d.original_title ?? null,
    ...(es ? { name_es: es.name, overview_es: es.overview } : {}),
    overview: d.overview ?? null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    first_air_date: d.release_date || null,
    status: d.status ?? null,
    // Una película trae su tconst en el propio payload, sin external_ids: es lo
    // que empareja el importador de notas de IMDb (scripts/imdb-ratings).
    ...(d.imdb_id !== undefined ? { imdb_id: d.imdb_id || null } : {}),
    genres: (d.genres ?? []).map((g: Any) => g.name),
    network: d.production_companies?.[0]?.name ?? null,
    ...(providers ? { providers } : {}),
    episode_run_time: d.runtime ?? null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    // Las dos fechas por país (0068), del mismo append. Como los proveedores:
    // presente solo cuando el payload lo trajo, para que una llamada sin el
    // append no vacíe lo que un detalle completo ya escribió.
    ...(releaseDates ? { release_dates: releaseDates } : {}),
    // La saga (0067). Se escribe siempre que el payload sea un detalle —
    // incluido el null — porque una película puede SALIR de una colección
    // cuando TMDB la reorganiza, y dejar el id viejo puesto la colgaría de una
    // saga que ya no es la suya.
    collection_id: d.belongs_to_collection?.id ?? null,
    collection_name: d.belongs_to_collection?.name ?? null,
    last_refreshed_at: new Date().toISOString(),
  };
}

/** TMDB release_dates → {ES: {theatrical, digital}, …}, listo para la columna.
 *
 *  Dos de los seis tipos que publica TMDB, que son los dos que alguien espera:
 *  3 (estreno en salas) y 4 (digital, o sea "ya la puedo ver en casa"). Se
 *  ignoran el 1 (premiere de festival), el 2 (estreno limitado — unas pocas
 *  salas, y anunciarlo como "en cines" manda a la gente a un cine que no la
 *  pone), el 5 (Blu-ray) y el 6 (televisión en abierto).
 *
 *  De cada tipo se guarda la fecha MÁS TEMPRANA del país: TMDB lista varias
 *  entradas de tipo 4 cuando la película pasa por varias plataformas, y la que
 *  importa es cuándo se pudo ver en casa por primera vez.
 *
 *  Devuelve undefined cuando el payload no traía el bloque — misma regla que
 *  providerMap: quien no lo pidió no puede borrarlo. Un {} sí sobrescribe, y
 *  significa lo que dice: TMDB ya no fecha esta película en ningún sitio. */
function releaseDateMap(d: Any): Record<string, Record<string, string>> | undefined {
  const results = d?.release_dates?.results;
  if (!Array.isArray(results)) return undefined;

  const TYPE = { 3: "theatrical", 4: "digital" } as const;
  const out: Record<string, Record<string, string>> = {};
  for (const country of results as Any[]) {
    const code = country?.iso_3166_1;
    if (!code) continue;
    const here: Record<string, string> = {};
    for (const r of (country.release_dates ?? []) as Any[]) {
      const kind = TYPE[r?.type as 3 | 4];
      const day = typeof r?.release_date === "string" ? r.release_date.slice(0, 10) : null;
      if (!kind || !day) continue;
      if (!here[kind] || day < here[kind]) here[kind] = day;
    }
    if (Object.keys(here).length) out[code] = here;
  }
  return out;
}

// Parcial, como searchRow: /search/movie trae genre_ids y ni duración ni
// estudio ni estado, así que esas columnas se omiten en vez de nulificarse para
// no vaciar una fila que un detalle completo ya había rellenado.
function movieSearchRow(r: Any) {
  return {
    tmdb_id: r.id,
    kind: "movie",
    name: r.title ?? r.original_title ?? "Untitled",
    overview: r.overview ?? null,
    poster_path: r.poster_path ?? null,
    backdrop_path: r.backdrop_path ?? null,
    first_air_date: r.release_date || null,
    genres: (r.genre_ids ?? []).map((id: number) => MOVIE_GENRES[id]).filter(Boolean),
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

/** `keep` carries the air times already resolved for this title, from TVmaze or
 *  from its platform's release rule (see keepResolvedTimes). An upsert writes
 *  every column in its payload, so without it a refresh would stamp the
 *  placeholder over good data and rely on the enrichment pass — which is allowed
 *  to fail silently — to put it back. */
const episodeRow = (
  titleId: string,
  seasonId: string,
  e: Any,
  keep: Map<string, ResolvedTime>,
) => {
  // Only carried through while TMDB still reports the same day for it — see
  // keepResolvedTimes. Otherwise it goes back to the placeholder and the
  // enrichment pass re-derives it from the day.
  const held = keep.get(`${e.season_number}x${e.episode_number}`);
  const known = held && held.airDate && held.airDate === (e.air_date || null) ? held : null;
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
    air_datetime: known ? known.at : airDatetime(e.air_date),
    air_time_source: known ? known.source : "estimated",
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

/** Every row of a windowed PostgREST query, not the first 1000 it hands back by
 *  default. `page` must impose a total order or rows slip between windows;
 *  errors are raised rather than read as an empty table.
 *
 *  Hand-mirror of episode-refresh/paging.ts, which carries the unit tests and
 *  the story — in short, One Piece's 1181 episodes meant the air-time pass never
 *  saw an episode later than its 1000th, which is every one still to air. Keep
 *  the two in sync. */
async function pageAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0;; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (data?.length) all.push(...data);
    if (!data || data.length < size) return all;
  }
}

interface ResolvedTime {
  at: string;
  airDate: string | null;
  source: AirTimeSource;
}

/** Air times already resolved for this title — TVmaze's clock or its platform's
 *  release rule — keyed `season x episode` and carrying the TMDB day each was
 *  derived from, so a TMDB refresh can bring them through its upsert instead of
 *  overwriting them with the 21:00 UTC placeholder. Without this a single failed
 *  enrichment (TVmaze outage, rate limit, show missing from their catalogue)
 *  would leave real air times lost until the next successful run.
 *
 *  The day rides along because carrying an instant through is only sound while
 *  TMDB still reports the same air_date for it (0060) — otherwise a reschedule,
 *  or a row the old number-only pairing mis-stamped, would be preserved forever
 *  by the very guard meant to protect good data. That applies to the platform
 *  rule too, where the instant is a day away from the anchor by design (0065):
 *  it is the ANCHOR that has to still hold, not the instant. */
async function keepResolvedTimes(
  admin: SupabaseClient,
  titleId: string,
): Promise<Map<string, ResolvedTime>> {
  // Paged and ordered — see pageAll below, and its tested twin in
  // episode-refresh/paging.ts.
  const data = await pageAll<Any>((from, to) =>
    admin
      .from("episodes")
      .select("season_number, episode_number, air_datetime, air_date, air_time_source")
      .eq("title_id", titleId)
      .in("air_time_source", ["tvmaze", "platform"])
      .order("season_number")
      .order("episode_number")
      .range(from, to)
  );
  const keep = new Map<string, ResolvedTime>();
  for (const e of data) {
    if (e.air_datetime) {
      keep.set(`${e.season_number}x${e.episode_number}`, {
        at: e.air_datetime,
        airDate: e.air_date ?? null,
        source: e.air_time_source,
      });
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

/** TVmaze's episode list for a title, or an empty index when there is nothing
 *  to read (no IMDb id to look it up by, not in their catalogue, upstream down).
 *  Every one of those is a normal outcome, not an error: the platform rule can
 *  still date the title, and a broadcaster without TVmaze simply keeps what it
 *  has. */
async function tvmazeIndex(admin: SupabaseClient, title: Any): Promise<TvmazeIndex> {
  const showId = await tvmazeShowId(admin, title);
  if (!showId) return indexTvmaze([]);
  const res = await fetch(`${TVMAZE}/shows/${showId}/episodes`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return indexTvmaze([]);
  return indexTvmaze(await res.json());
}

/** Replace a title's 21:00 UTC placeholders with the real release instant:
 *  TVmaze's airstamp where a broadcaster publishes one — absolute, DST already
 *  resolved — and otherwise the platform's own release rule, on the day
 *  resolveAirTime works out. Best-effort: TVmaze being down, or simply not
 *  carrying the show, costs nothing a platform rule can't replace, and titles
 *  with neither are left exactly as they were. Specials are skipped — TVmaze
 *  numbers them on its own scheme and every gate in the app filters
 *  season_number > 0 anyway. */
async function enrichAirTimes(admin: SupabaseClient, titleId: string) {
  const { data: title } = await admin
    .from("titles").select("id, imdb_id, tvmaze_id, network, providers").eq("id", titleId).maybeSingle();
  if (!title) return;

  // What streams it beats where it once aired — see rulePlatform above.
  const platform = rulePlatform(title);

  const idx = await tvmazeIndex(admin, title);
  // Neither source has anything to say about this title.
  if (!idx.size && !platform) return;

  const eps = await pageAll<Any>((from, to) =>
    admin
      .from("episodes")
      .select("title_id, season_number, episode_number, air_date, air_datetime, air_time_source")
      .eq("title_id", titleId)
      .gt("season_number", 0)
      .order("season_number")
      .order("episode_number")
      .range(from, to)
  );
  const ctx = { platform, realign: alignedSeasons(eps, idx) };

  const rows: Any[] = [];
  for (const e of eps) {
    // Nothing usable came back (outage, empty catalogue). resolveAirTime answers
    // for every anchored row, demotion included, so without this guard a bad
    // read would be taken as "TVmaze no longer accounts for any of these" and
    // strip a whole broadcaster's clocks.
    if (!idx.size && e.air_time_source === "tvmaze") continue;
    const want = resolveAirTime(e, idx, ctx);
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
  if (error) console.error(`air times: ${error.message}`);
}

// How long a cached title (and its seasons/episodes) is served without any
// TMDB round trip. Matches the daily episode-refresh cron cadence, so followed
// shows are effectively always a cache hit.
const FRESH_MS = 24 * 3600 * 1000;

const freshWithin = (at: string | null | undefined) =>
  Boolean(at) && Date.now() - new Date(at as string).getTime() < FRESH_MS;

/** The title row's own detail (name, status, providers, scores). Written by
 *  every full-detail fetch, the discovery warm-up's included. */
const isFresh = (title: Any) => freshWithin(title?.last_refreshed_at);

/** The title's EPISODES. A different fact, and only the passes that actually
 *  refetch episodes write it — the episode-refresh cron and fillWholeShow below.
 *  Using isFresh() here instead was a real bug: the popular-now warm-up writes
 *  full title rows without a single season, so it made cached episodes look
 *  revalidated when nothing had looked at them. See migration 0066. */
const hasFreshEpisodes = (title: Any) => freshWithin(title?.episodes_refreshed_at);

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
  const [title] = await upsertReturning(admin, "titles", titleRow(d), "kind,tmdb_id");
  inBackground(cacheNetworkLogos(admin, d.networks));
  const seasons = (d.seasons ?? []).length
    ? await upsertReturning(admin, "seasons", d.seasons.map((s: Any) => seasonRow(title.id, s)), "title_id,number")
    : [];
  return { title, seasons };
}

/** TMDB → caché de una película; devuelve la forma de GET /movie/:id.
 *
 *  Sin temporadas y sin episodios: el episodio sintético que hace que "vista"
 *  se pueda escribir lo pone el trigger de 0067 al guardar el título, así que
 *  aquí no hay nada más que hacer. La saga se queda en dos columnas de la
 *  propia fila; las hermanas las trae /movie/:id/saga.
 *
 *  Sin cacheNetworkLogos: esa caché guarda logos de CADENAS, y lo que una
 *  película trae en `network` es su estudio — que no tiene logo en TMDB por esa
 *  vía. Los logos que la ficha sí enseña son los de las plataformas, y esos
 *  vienen en `providers`, no de aquí. */
async function refreshMovie(admin: SupabaseClient, apiKey: string, tmdbId: number) {
  const d = await fetchTmdb(apiKey, `/movie/${tmdbId}?append_to_response=translations,watch/providers,release_dates`);
  const [title] = await upsertReturning(admin, "titles", movieRow(d), "kind,tmdb_id");
  // El upsert no puede devolver el episodio que su propio trigger acaba de
  // escribir, así que en el camino frío sí hay un viaje más — uno, y solo la
  // primera vez que alguien abre esta película.
  const { data: ep } = await admin
    .from("episodes").select("id").eq("title_id", title.id).limit(1).maybeSingle();
  return { title, episodeId: (ep?.id as string | undefined) ?? null };
}

/** El id del episodio sintético de una película — lo que marcar "vista" escribe
 *  en watch_events, que sigue siendo una tabla de episodios (0067).
 *
 *  Viaja en la respuesta en vez de dejar que el cliente lo busque: es un dato
 *  que la ficha necesita antes del primer clic, y pedirlo aparte es una espera
 *  más en el camino de algo que ya está resuelto aquí. Nulo solo si alguien
 *  escribió la fila esquivando el trigger, y entonces la ficha se dibuja sin
 *  botón de marcar en lugar de fingir uno que fallaría.
 *
 *  Se lee INCRUSTADO en el propio select del título, como /title hace con sus
 *  temporadas: en una fila caliente el viaje aparte era el único que quedaba, y
 *  lo pagaba cada apertura de ficha. */
const episodeIdOf = (row: Any): string | null => row?.episodes?.[0]?.id ?? null;

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
  const keep = await keepResolvedTimes(admin, titleId);
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

  // This pass and the episode-refresh cron are the only two writers of the
  // episode freshness mark, because they are the only two that refresh a show's
  // whole maintained episode set. A single-season refreshSeason deliberately
  // does NOT stamp it: marking the title on the strength of one season would let
  // someone opening season 1 convince the nightly cron that the season now
  // airing is fresh — the very starvation migration 0066 undoes, just by a
  // rarer route. The cost is that a stale season revalidates in the background
  // on each open until the cron comes round; one request, off the hot path.
  //
  // Gated on `wrote` for the same reason the TVmaze pass above is: a fill that
  // brought in nothing (every season already held, or an announced season TMDB
  // has no episodes for) has not earned the mark, and stamping it anyway would
  // silence a whole show's revalidation for a day on the strength of a no-op.
  if (!wrote) return;
  const { error } = await admin
    .from("titles")
    .update({ episodes_refreshed_at: new Date().toISOString() })
    .eq("id", titleId);
  if (error) console.error(`episodes_refreshed_at: ${error.message}`);
}

const fetchTmdb = async (apiKey: string, p: string) => {
  const res = await fetch(`${TMDB}${p}${p.includes("?") ? "&" : "?"}api_key=${apiKey}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TMDB ${p}: ${res.status}`); // don't treat an error body as data
  return res.json();
};

/* ── discovery caches ────────────────────────────────────────────────────────
   Four routes feed Explore, and all four are the same shape: work out an
   ORDER over tmdb_ids (the expensive part — several TMDB pages, sometimes a
   detail check per candidate), then hand back the title rows we already hold.
   Only the order is worth caching, and it is what these resolvers cache.

   /trending and /popular-now keep their own tables (they predate this and the
   client reads trending_cache's shape nowhere, so there was nothing to gain by
   merging them). /popular and /top-rated had no cache at all until 0064: every
   request re-fetched 5–8 TMDB pages and re-upserted a couple of hundred rows
   before answering, which is most of why opening a discover tab cold took
   seconds.

   `force` is the warming cron's flag: rebuild regardless of freshness, so the
   cron does not have to race the very TTL it exists to stay ahead of. */
const DISCOVER_TTL_MS = 24 * 3600 * 1000;

/** Title rows for an ordered tmdb_id list, in that order.
 *
 *  `kind` no tiene valor por defecto a propósito: un id de TMDB solo es único
 *  dentro de su medio (0067), así que quien pide una rejilla tiene que decir de
 *  cuál — sin eso, una película con el mismo id se colaría entre las series. */
async function titlesInOrder(admin: SupabaseClient, tmdbIds: number[], kind: "tv" | "movie"): Promise<Any[]> {
  if (tmdbIds.length === 0) return [];
  const { data } = await admin.from("titles").select("*").eq("kind", kind).in("tmdb_id", tmdbIds);
  const byTmdb = new Map((data ?? []).map((r: Any) => [r.tmdb_id, r]));
  return tmdbIds.map((id) => byTmdb.get(id)).filter(Boolean);
}

async function readDiscoverCache(admin: SupabaseClient, key: string): Promise<number[] | null> {
  const { data } = await admin
    .from("discover_cache")
    .select("tmdb_ids, cached_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.cached_at).getTime() >= DISCOVER_TTL_MS) return null;
  const ids = (data.tmdb_ids ?? []).map(Number);
  return ids.length > 0 ? ids : null;
}

async function writeDiscoverCache(admin: SupabaseClient, key: string, ids: number[]) {
  // Never cache an empty pool: that only happens when TMDB is failing, and
  // remembering the failure for 24h would turn a blip into a dead tab.
  if (ids.length === 0) return;
  await admin
    .from("discover_cache")
    .upsert(
      { cache_key: key, tmdb_ids: ids, cached_at: new Date().toISOString() },
      { onConflict: "cache_key" },
    );
}

/** Dedupe a set of TMDB discover pages, dropping hidden genres. A repeated
 *  tmdb_id inside one upsert batch errors ("cannot affect row a second time"),
 *  so this runs before every write, not just for tidiness. */
function dedupeVisible(pages: Any[]): Any[] {
  const seen = new Set<number>();
  const out: Any[] = [];
  for (const r of pages.flatMap((d) => d.results ?? [])) {
    if (r?.id != null && !seen.has(r.id) && !isHidden(r)) { seen.add(r.id); out.push(r); }
  }
  return out;
}

/** TMDB /trending/tv/week, cached 24h in trending_cache. */
async function resolveTrending(admin: SupabaseClient, apiKey: string, force = false): Promise<number[]> {
  if (!force) {
    const dayAgo = new Date(Date.now() - DISCOVER_TTL_MS).toISOString();
    const { data: fresh } = await admin
      .from("trending_cache")
      .select("tmdb_id, rank")
      .gte("cached_at", dayAgo)
      .order("rank");
    if (fresh && fresh.length > 0) return fresh.map((r: Any) => r.tmdb_id as number);
  }
  // Pull a couple of pages: after hiding anime/soaps/reality/etc a single
  // 20-item page thins out, so we go wider and keep the top TREND_KEEP.
  const TREND_PAGES = 2;
  const TREND_KEEP = 24;
  const pages = await Promise.all(
    Array.from({ length: TREND_PAGES }, (_, i) => fetchTmdb(apiKey, `/trending/tv/week?page=${i + 1}`)),
  );
  const results = capNonWestern(dedupeVisible(pages));
  results.length = Math.min(results.length, TREND_KEEP);
  if (results.length === 0) return [];
  await upsertReturning(admin, "titles", results.map(searchRow), "kind,tmdb_id");
  const ranked = results.map((r, i) => ({ tmdb_id: r.id as number, rank: i + 1 }));
  // Upsert (not delete+insert) so two concurrent cold-cache refreshes can't
  // collide on the PK. Stale rows keep their old cached_at and are filtered out
  // by the 24h window above.
  const now = new Date().toISOString();
  await admin
    .from("trending_cache")
    .upsert(ranked.map((r) => ({ ...r, cached_at: now })), { onConflict: "tmdb_id" });
  return ranked.map((r) => r.tmdb_id);
}

/** Shows with a *season premiere* (S1 or a new season) in the last 90 days or
 *  the next 30, ranked by TMDB popularity, cached 24h in popular_now_cache.
 *
 *  Raw popularity.desc favours long-running syndicated shows (SVU, Grey's…);
 *  gating on a premiere keeps the grid about things happening *now*. Discover
 *  can't see season dates, so we detail-check the top candidates — which is why
 *  a cold rebuild here is the slowest thing the proxy does, and why the warming
 *  cron exists. */
async function resolvePopularNow(admin: SupabaseClient, apiKey: string, force = false): Promise<number[]> {
  if (!force) {
    const dayAgo = new Date(Date.now() - DISCOVER_TTL_MS).toISOString();
    const { data: fresh } = await admin
      .from("popular_now_cache")
      .select("tmdb_id, rank")
      .gte("cached_at", dayAgo)
      .order("rank");
    if (fresh && fresh.length > 0) return fresh.map((r: Any) => r.tmdb_id as number);
  }
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
  const candidates = dedupeVisible(pages);
  candidates.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  // Cap + boost before the detail-check so the fetch budget isn't spent on
  // titles the quota would drop anyway (and so Spanish candidates survive into
  // the top CANDIDATES); both run again after the premiere gate below, since
  // dropping non-premiering rows skews ratios back.
  const pool = capNonWestern(boostSpanish(candidates));
  pool.length = Math.min(pool.length, CANDIDATES);
  // Detail-check in chunks (TMDB rate limit): keep shows with a real season
  // (not specials) premiering inside the window.
  const premiered: Any[] = [];
  const CHUNK = 20;
  for (let i = 0; i < pool.length; i += CHUNK) {
    const details = await Promise.all(
      // Same request count with the appends, and it means a discover row
      // already carries its providers and Spanish title the first time it
      // is rendered. external_ids is not a nicety here: titleRow stamps
      // last_refreshed_at, so a payload without it writes a row that looks
      // fully detailed to /title while imdb_id stays null — and imdb_id is
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
  if (keep.length === 0) return [];
  // We hold full details here, so upsert the rich row (network, status…).
  await upsertReturning(admin, "titles", keep.map(titleRow), "kind,tmdb_id");
  await cacheNetworkLogos(admin, keep.flatMap((d: Any) => d.networks ?? []));
  const ranked = keep.map((d, i) => ({ tmdb_id: d.id as number, rank: i + 1 }));
  const now = new Date().toISOString();
  await admin
    .from("popular_now_cache")
    .upsert(ranked.map((r) => ({ ...r, cached_at: now })), { onConflict: "tmdb_id" });
  return ranked.map((r) => r.tmdb_id);
}

/** Popular TV by popularity, optionally inside a first-air-year range. */
async function resolvePopular(
  admin: SupabaseClient, apiKey: string, from: string | null, to: string | null, force = false,
): Promise<number[]> {
  const key = `popular:${from ?? ""}:${to ?? ""}`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
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
  const uniq = capNonWestern(boostSpanish(dedupeVisible(pages)));
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(searchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

/** Top-rated TV (TMDB /discover/tv sorted by rating; genre ids are OR-ed).
 *
 *  The vote_count floor is the honesty knob — fan-niche titles rate 8.6+ on few
 *  votes — but a fixed high floor starves filtered charts (the 1970s have two
 *  1000-vote shows, Documentary has zero at 3000), so it slides with the era and
 *  drops when a genre is picked. When `from` sits in the last few years the
 *  whole range is too young to have accrued votes (a 2026 premiere can't reach
 *  1000), so the floor collapses as `from` approaches today. boostSpanish is
 *  deliberately skipped: injecting lower-rated titles would falsify a by-rating
 *  chart; capNonWestern only demotes, so the order within Western titles stays
 *  honest. */
async function resolveTopRated(
  admin: SupabaseClient, apiKey: string, from: string | null, to: string | null,
  genres: string[], force = false,
): Promise<number[]> {
  const key = `top-rated:${from ?? ""}:${to ?? ""}:${genres.join(",")}`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
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
  const uniq = capNonWestern(dedupeVisible(pages));
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(searchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}


/* ── descubrimiento de cine ──────────────────────────────────────────────────
   Tres resolvedores gemelos de los de series, contra /discover/movie y
   /trending/movie. Comparten con ellos la tabla discover_cache (su clave es una
   cadena libre, así que basta con prefijarla) y las dos reglas de reordenación
   de ./rank.ts, que hablan de idioma y país de origen y no de episodios.

   No hay gemelo de /popular-now: aquel existe porque una serie "está pasando"
   cuando estrena temporada, y hace una comprobación de detalle por candidata
   para averiguarlo. Una película no tiene temporadas — lo que está pasando en
   cine es literalmente lo que hay en cartelera, y eso TMDB lo da hecho en
   /movie/now_playing, sin una sola petición extra por título.

   El filtro de contenido oculto (isHidden, dentro de dedupeVisible) mira
   genre_ids, y los ids de género de cine son OTROS: 16 (animación) coincide,
   pero 10764/10766 (reality y culebrón) no existen en cine y ningún id de cine
   los ocupa. Es decir: para películas el filtro degrada a "anime y lenguas
   ocultas", que es exactamente lo que debe hacer. */

async function resolveMovieTrending(admin: SupabaseClient, apiKey: string, force = false): Promise<number[]> {
  const key = "movie-trending:";
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
  const PAGES = 2;
  const KEEP = 24;
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchTmdb(apiKey, `/trending/movie/week?page=${i + 1}`)),
  );
  const uniq = capNonWestern(dedupeVisible(pages));
  uniq.length = Math.min(uniq.length, KEEP);
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(movieSearchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

/** En cartelera: lo que TMDB dice que está en salas ahora mismo, por
 *  popularidad. El equivalente de "popular ahora" en series, y mucho más barato
 *  que aquel — la pregunta "¿qué se puede ver hoy?" la responde TMDB entera.
 *
 *  POR PAÍS, y es la única de las cuatro que lo necesita: una cartelera es de
 *  un sitio. Sin `region` TMDB responde la de Estados Unidos, así que la
 *  pestaña que existe para decirte qué puedes ir a ver te enseñaba lo que están
 *  poniendo a ocho mil kilómetros. La caché lleva el país en la clave por lo
 *  mismo. Las otras tres (tendencias, populares, mejor valoradas) son preguntas
 *  sobre el catálogo, no sobre las salas, y no cambian con el país. */
async function resolveMovieNowPlaying(
  admin: SupabaseClient, apiKey: string, region: string, force = false,
): Promise<number[]> {
  const key = `movie-now-playing:${region}`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
  const PAGES = 3;
  const KEEP = 40;
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      fetchTmdb(apiKey, `/movie/now_playing?region=${encodeURIComponent(region)}&page=${i + 1}`)),
  );
  const visible = dedupeVisible(pages);
  // Un solo orden, y el último que se aplica manda: popularidad primero para
  // que la cartelera salga por lo que la gente va a ver, y el suelo español
  // después, que es la misma corrección deliberada de las otras rejillas.
  visible.sort((a: Any, b: Any) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const uniq = capNonWestern(boostSpanish(visible));
  uniq.length = Math.min(uniq.length, KEEP);
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(movieSearchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

async function resolveMoviePopular(
  admin: SupabaseClient, apiKey: string, from: string | null, to: string | null, force = false,
): Promise<number[]> {
  const key = `movie-popular:${from ?? ""}:${to ?? ""}`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
  // primary_release_date, no first_air_date: en cine la columna se llama de otra
  // forma, y pasar la de series devuelve el catálogo entero sin filtrar.
  const yearParams =
    (from ? `&primary_release_date.gte=${from}-01-01` : "") +
    (to ? `&primary_release_date.lte=${to}-12-31` : "");
  const PAGES = 5;
  const ES_PAGES = 2;
  const pages = await Promise.all([
    ...Array.from({ length: PAGES }, (_, i) =>
      fetchTmdb(apiKey, `/discover/movie?sort_by=popularity.desc&include_adult=false&page=${i + 1}${yearParams}`)),
    ...Array.from({ length: ES_PAGES }, (_, i) =>
      fetchTmdb(apiKey, `/discover/movie?sort_by=popularity.desc&include_adult=false&with_origin_country=ES&page=${i + 1}${yearParams}`)),
  ]);
  const uniq = capNonWestern(boostSpanish(dedupeVisible(pages)));
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(movieSearchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

/** Mejor valoradas. Mismo suelo deslizante de votos que en series y por lo
 *  mismo (una nota de 9 con 40 votos no es una nota), pero más alto en la base:
 *  el catálogo de cine de TMDB es mucho más grande y más votado que el de
 *  series, y 3000 votos ahí no vacían una década. */
async function resolveMovieTopRated(
  admin: SupabaseClient, apiKey: string, from: string | null, to: string | null,
  genres: string[], force = false,
): Promise<number[]> {
  const key = `movie-top-rated:${from ?? ""}:${to ?? ""}:${genres.join(",")}`;
  if (!force) {
    const hit = await readDiscoverCache(admin, key);
    if (hit) return hit;
  }
  const thisYear = new Date().getUTCFullYear();
  const era = Number(from ?? to);
  const eraFloor =
    !from && !to ? 5000
    : Number(from) >= thisYear - 1 ? 100
    : Number(from) >= thisYear - 4 ? 600
    : era >= 2005 ? 2000
    : era >= 1990 ? 1000
    : 400;
  const minVotes = genres.length ? Math.min(eraFloor, 1000) : eraFloor;
  const params =
    `&sort_by=vote_average.desc&vote_count.gte=${minVotes}` +
    (from ? `&primary_release_date.gte=${from}-01-01` : "") +
    (to ? `&primary_release_date.lte=${to}-12-31` : "") +
    (genres.length ? `&with_genres=${genres.join("%7C")}` : "");
  const PAGES = 8;
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      fetchTmdb(apiKey, `/discover/movie?include_adult=false${params}&page=${i + 1}`)),
  );
  const uniq = capNonWestern(dedupeVisible(pages));
  if (uniq.length === 0) return [];
  await upsertReturning(admin, "titles", uniq.map(movieSearchRow), "kind,tmdb_id");
  const ids = uniq.map((r) => r.id as number);
  await writeDiscoverCache(admin, key, ids);
  return ids;
}

/* ── invite gate ─────────────────────────────────────────────────────────────
   The gate is a PostgREST round trip, and it used to run on every single
   request. Explore alone opens with several — same reader, same token, same
   question, asked concurrently — and each one paid for it before touching a
   cache that was already warm.

   So memoise the verdict against the exact access token that earned it. What
   makes this sound rather than a hole: the key IS the credential. Nothing can
   read a cached entry without presenting the very token that was verified, so
   this can never admit a request the RPC would have turned away. It can only
   serve a verdict slightly late — an invite revoked mid-session stays usable
   for up to a minute, and the invite gate is advisory anyway (RLS on the user
   tables is the actual wall, and it is not cached here).

   Only "invited" is cached. A rejection isn't, so redeeming an invite takes
   effect on the very next request instead of stranding the new user for a
   minute on the gate they just cleared. */
const GATE_TTL_MS = 60_000;
const GATE_MAX_ENTRIES = 500;
const gateCache = new Map<string, number>(); // token → epoch ms the verdict expires

/** The `exp` a JWT carries, in epoch ms. Unverified — read only to shorten the
 *  memo, never to lengthen it, so a forged claim buys nothing. */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null; // opaque or malformed — the RPC is about to reject it anyway
  }
}

function gateHit(token: string): boolean {
  const until = gateCache.get(token);
  if (until == null) return false;
  if (until <= Date.now()) {
    gateCache.delete(token);
    return false;
  }
  return true;
}

function rememberGate(token: string) {
  const exp = jwtExpiry(token);
  const until = Math.min(Date.now() + GATE_TTL_MS, exp ?? Infinity);
  if (until <= Date.now()) return; // already expired — nothing worth holding
  // Plain FIFO eviction. The isolate is short-lived and the map only ever holds
  // the handful of tokens it has served; the cap is a memory backstop, not a
  // policy.
  if (gateCache.size >= GATE_MAX_ENTRIES) {
    const oldest = gateCache.keys().next().value;
    if (oldest !== undefined) gateCache.delete(oldest);
  }
  gateCache.set(token, until);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestStarted = performance.now();

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isCron = bearer.length > 0 && bearer === serviceKey;

  // --- auth + invite gate (one PostgREST round trip, memoised per token) ---
  // The warming cron presents the service-role key and skips the gate: there is
  // no user behind it to invite, and it only ever rebuilds caches.
  if (!isCron && !gateHit(bearer)) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: invited, error: gateError } = await userClient.rpc("is_current_user_invited");
    if (gateError) return json({ error: "unauthorized" }, 401);
    if (!invited) return json({ error: "not invited" }, 403);
    rememberGate(bearer);
  }
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
    // POST /warm — service-role only. Rebuilds every discovery cache ahead of
    // the readers, so nobody has to stand behind a cold one.
    //
    // The caches expire on a 24h TTL, which means somebody always paid to
    // rebuild them: the first person to open Explore after they lapsed wore the
    // whole cost, and on a small user base that is the same handful of people
    // every day. popular-now is the worst of it — 8 discover pages plus up to
    // 80 sequential TMDB detail fetches, the ~5s the grid used to take to
    // appear. This moves that work to 04:40 UTC, before anyone is looking.
    //
    // Rebuilds unconditionally rather than honouring the TTL: the cron fires on
    // roughly the same period as the TTL it exists to stay ahead of, so a
    // freshness check would have it skip a cache about to expire an hour later.
    //
    // Only the UNFILTERED pools are warmed. Filtered ones (a year range, a
    // genre) are a combinatorial space nobody could pre-compute, and they are
    // reached by deliberate interaction — where a skeleton and a beat's wait
    // read as the filter working, not as the app being slow.
    if (path === "/warm") {
      if (!isCron) return json({ error: "unauthorized" }, 401);
      const startedAt = new Date().toISOString();
      const jobs: [string, () => Promise<number[]>][] = [
        ["trending", () => resolveTrending(admin, apiKey, true)],
        ["popular-now", () => resolvePopularNow(admin, apiKey, true)],
        ["popular", () => resolvePopular(admin, apiKey, null, null, true)],
        ["top-rated", () => resolveTopRated(admin, apiKey, null, null, [], true)],
        // El cine entra en la misma corrida y por el mismo motivo: sus cuatro
        // cachés caducan igual, y sin esto el primero que abriera Explorar de
        // películas después de las 24 h pagaría la reconstrucción entera.
        ["movie-trending", () => resolveMovieTrending(admin, apiKey, true)],
        // Solo ES: es el país de casi todo el mundo aquí, y calentar tres
        // carteleras por si acaso es gastar por adelantado en dos que puede
        // que nadie pida. Las otras se construyen a la primera visita.
        ["movie-now-playing", () => resolveMovieNowPlaying(admin, apiKey, "ES", true)],
        ["movie-popular", () => resolveMoviePopular(admin, apiKey, null, null, true)],
        ["movie-top-rated", () => resolveMovieTopRated(admin, apiKey, null, null, [], true)],
      ];
      // Sequentially: these are the heaviest TMDB consumers in the codebase and
      // running them at once is how a rate limit turns four warm caches into
      // four cold ones. Nobody is waiting on this response.
      const summary: Record<string, number | string> = {};
      let ok = true;
      for (const [name, run] of jobs) {
        try {
          summary[name] = (await run()).length;
        } catch (e) {
          ok = false;
          summary[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      // Best-effort bookkeeping — never fail the run on the log write (0029).
      await admin.from("job_runs").insert({
        job: "discover-warm",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok,
        summary,
      }).then(() => {}, () => {});
      return json({ ok, summary }, ok ? 200 : 500);
    }

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
      let saved = await upsertReturning(admin, "titles", results.map(searchRow), "kind,tmdb_id");
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
        if (patches.length) saved = await upsertReturning(admin, "titles", patches, "kind,tmdb_id");
      }
      // preserve TMDB relevance order
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: results.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /trending  (TMDB /trending/tv/week, cached 24h in trending_cache)
    if (path === "/trending") {
      return json({ results: await titlesInOrder(admin, await resolveTrending(admin, apiKey), "tv") });
    }

    // GET /popular-now  — see resolvePopularNow.
    if (path === "/popular-now") {
      return json({ results: await titlesInOrder(admin, await resolvePopularNow(admin, apiKey), "tv") });
    }

    // GET /popular?from=YYYY&to=YYYY  — see resolvePopular.
    if (path === "/popular") {
      const ids = await resolvePopular(admin, apiKey, url.searchParams.get("from"), url.searchParams.get("to"));
      return json({ results: await titlesInOrder(admin, ids, "tv") });
    }

    // GET /top-rated?from=YYYY&to=YYYY&genres=18,80  — see resolveTopRated.
    if (path === "/top-rated") {
      const genres = (url.searchParams.get("genres") ?? "")
        .split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      const ids = await resolveTopRated(
        admin, apiKey,
        url.searchParams.get("from") || null,
        url.searchParams.get("to") || null,
        genres,
      );
      return json({ results: await titlesInOrder(admin, ids, "tv") });
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
      const saved = await upsertReturning(admin, "titles", uniq.map(searchRow), "kind,tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: uniq.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    /* ── películas ───────────────────────────────────────────────────────────
       Tres rutas, hermanas de /search, /title/:id y /title/:id/credits. Van
       antes que ellas por una razón de forma, no de gusto: /movie/:id ha de
       leerse antes que cualquier patrón más suelto, y tenerlas juntas evita que
       la próxima ruta que alguien añada se cuele en medio. */

    // GET /movie/search?q=&lang=es — mismo trato que /search: TMDB ya encuentra
    // por título traducido, y lang=es solo añade la pasada que rellena
    // name_es / original_name para que la paleta pueda enseñarlo en español.
    if (path === "/movie/search") {
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ results: [] });
      const wantEs = url.searchParams.get("lang") === "es";
      const [data, esData] = await Promise.all([
        fetchTmdb(apiKey, `/search/movie?query=${encodeURIComponent(q)}&include_adult=false`),
        wantEs
          ? fetchTmdb(apiKey, `/search/movie?query=${encodeURIComponent(q)}&include_adult=false&language=es-ES`).catch(() => null)
          : Promise.resolve(null),
      ]);
      const results: Any[] = data.results ?? [];
      if (results.length === 0) return json({ results: [] });
      let saved = await upsertReturning(admin, "titles", results.map(movieSearchRow), "kind,tmdb_id");
      const esById = new Map(((esData?.results ?? []) as Any[]).map((r) => [r.id, r]));
      if (wantEs && esById.size > 0) {
        const patches = results
          .map((r) => {
            const es = esById.get(r.id);
            if (!es) return null;
            return {
              tmdb_id: r.id,
              kind: "movie",
              name: r.title ?? r.original_title ?? "Untitled",
              original_name: es.original_title ?? r.original_title ?? null,
              // La búsqueda en es-ES devuelve el título original cuando no hay
              // traducción: solo se guarda un título español de verdad.
              name_es: es.title && es.title !== es.original_title ? es.title : null,
            };
          })
          .filter(Boolean);
        if (patches.length) saved = await upsertReturning(admin, "titles", patches, "kind,tmdb_id");
      }
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({ results: results.map((r) => byTmdb.get(r.id)).filter(Boolean) });
    }

    // GET /movie/trending | /movie/now-playing | /movie/popular | /movie/top-rated
    // Gemelas de las cuatro de series, contra el catálogo de cine. Van antes que
    // /movie/:id porque ninguna es un número y el regex de aquel no las cogería,
    // pero tenerlas delante deja el orden de lectura igual que el de arriba.
    if (path === "/movie/trending") {
      return json({ results: await titlesInOrder(admin, await resolveMovieTrending(admin, apiKey), "movie") });
    }
    if (path === "/movie/now-playing") {
      // El país lo manda el cliente (el de Ajustes), y se valida aquí: es un
      // parámetro de URL que acaba en una petición a TMDB, así que solo pasan
      // dos letras. ES por defecto — el mercado desde el que se mira esta app,
      // el mismo criterio que PROVIDER_COUNTRIES.
      const raw = (url.searchParams.get("region") ?? "ES").toUpperCase();
      const region = /^[A-Z]{2}$/.test(raw) ? raw : "ES";
      const ids = await resolveMovieNowPlaying(admin, apiKey, region);
      return json({ results: await titlesInOrder(admin, ids, "movie") });
    }
    if (path === "/movie/popular") {
      const ids = await resolveMoviePopular(admin, apiKey, url.searchParams.get("from"), url.searchParams.get("to"));
      return json({ results: await titlesInOrder(admin, ids, "movie") });
    }
    if (path === "/movie/top-rated") {
      const genres = (url.searchParams.get("genres") ?? "")
        .split(",").map((g) => g.trim()).filter((g) => /^\d+$/.test(g));
      const ids = await resolveMovieTopRated(
        admin, apiKey,
        url.searchParams.get("from") || null,
        url.searchParams.get("to") || null,
        genres,
      );
      return json({ results: await titlesInOrder(admin, ids, "movie") });
    }

    // GET /movie/:id/credits — reparto y dirección. La dirección es la mitad
    // que no existe en series: en la ficha de una película el director es un
    // enlace a /person/:id, así que sale de aquí y no del reparto.
    const mMovieCredits = path.match(/^\/movie\/(\d+)\/credits$/);
    if (mMovieCredits) {
      const d = await fetchTmdb(apiKey, `/movie/${mMovieCredits[1]}/credits`);
      const cast = ((d.cast ?? []) as Any[])
        .slice(0, 24)
        .map((c) => ({
          id: c.id,
          name: c.name ?? "",
          profile_path: c.profile_path ?? null,
          character: c.character ?? null,
          episode_count: null,
        }));
      // Solo dirección y guion, que es lo que la ficha imprime. `job` es la
      // única forma de distinguirlos: el departamento "Writing" incluye media
      // docena de oficios (story, characters, novel…) y listarlos todos llena
      // la línea de nombres que nadie buscaba.
      const crew = ((d.crew ?? []) as Any[])
        .filter((c) => c.job === "Director" || c.job === "Screenplay" || c.job === "Writer")
        .map((c) => ({
          id: c.id,
          name: c.name ?? "",
          profile_path: c.profile_path ?? null,
          job: c.job as string,
        }));
      return json({ cast, crew }, 200, { "Cache-Control": "private, max-age=86400" });
    }

    // GET /movie/:id/saga — las entregas de la saga a la que pertenece esta
    // película, en orden de estreno.
    //
    // Guarda cada hermana como título propio antes de devolverla, igual que
    // hacen /search y las rejillas de descubrimiento. Eso es lo que permite
    // abrir cualquiera de ellas desde la ficha sin una segunda espera, y lo que
    // deja al cliente resolver por su cuenta si la tienes vista o puntuada:
    // aquí no se cruza nada con la biblioteca, que es de quien la mira.
    const mSaga = path.match(/^\/movie\/(\d+)\/saga$/);
    if (mSaga) {
      const tmdbId = Number(mSaga[1]);
      const { data: row } = await admin
        .from("titles").select("collection_id, collection_name, status")
        .eq("kind", "movie").eq("tmdb_id", tmdbId).maybeSingle();
      // Sin detalle todavía (solo búsqueda) no hay columna que leer: se resuelve
      // ahora, que es una petición y evita devolver "no tiene saga" a una que sí.
      const meta = row?.status ? row : (await refreshMovie(admin, apiKey, tmdbId)).title;
      if (!meta?.collection_id) return json({ collection: null, parts: [] });
      const d = await fetchTmdb(apiKey, `/collection/${meta.collection_id}`);
      const parts: Any[] = (d.parts ?? []).filter((p: Any) => p?.id != null);
      if (parts.length === 0) return json({ collection: null, parts: [] });
      // Por fecha de estreno; las anunciadas sin fecha van al final, que es
      // donde la siguiente entrega de una saga pertenece.
      parts.sort((a, b) => (a.release_date || "9999").localeCompare(b.release_date || "9999"));
      const saved = await upsertReturning(admin, "titles", parts.map(movieSearchRow), "kind,tmdb_id");
      const byTmdb = new Map(saved.map((r: Any) => [r.tmdb_id, r]));
      return json({
        collection: { id: d.id, name: meta.collection_name ?? d.name ?? null },
        parts: parts.map((p) => byTmdb.get(p.id)).filter(Boolean),
      }, 200, { "Cache-Control": "private, max-age=86400" });
    }

    // GET /movie/:id — cache-first, como /title/:id, pero más simple: una
    // película es una fila y ya está, así que basta con que la fila exista, sea
    // un detalle completo y esté fresca.
    const mMovie = path.match(/^\/movie\/(\d+)$/);
    if (mMovie) {
      const tmdbId = Number(mMovie[1]);
      const dbStarted = performance.now();
      const { data: cached } = await admin
        .from("titles").select("*, episodes(id)").eq("kind", "movie").eq("tmdb_id", tmdbId).maybeSingle();
      const dbMs = performance.now() - dbStarted;
      // `status` es la prueba de que esta fila salió de un detalle completo y no
      // de una búsqueda: movieSearchRow no lo escribe. Sin esa comprobación, la
      // primera peli que abrieras después de buscarla se serviría sin duración,
      // sin plataformas y sin género en español.
      if (cached?.status) {
        const stale = !isFresh(cached);
        if (stale) inBackground(refreshMovie(admin, apiKey, tmdbId));
        // `episodes` es la incrustación, no una columna de titles: fuera del
        // título antes de devolverlo, o el cliente recibiría una forma que su
        // esquema no conoce.
        const { episodes, ...title } = cached;
        return json(
          { title, episode_id: episodeIdOf({ episodes }) },
          200,
          detailHeaders(stale ? "STALE" : "HIT", dbMs),
        );
      }
      const fillStarted = performance.now();
      const filled = await refreshMovie(admin, apiKey, tmdbId);
      return json(
        { title: filled.title, episode_id: filled.episodeId },
        200,
        detailHeaders("MISS", dbMs, performance.now() - fillStarted),
      );
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
      const d = await fetchTmdb(
        apiKey,
        `/person/${mPerson[1]}?append_to_response=tv_credits,movie_credits,translations`,
      );

      /* La filmografía, con los dos medios en UNA lista.
       *
       * Cada crédito lleva su `kind` y el cliente pinta el glifo; no se separan
       * en dos secciones porque la mayoría de la gente solo tiene uno, y quien
       * tiene los dos suele venir justo a ver la carrera entera.
       *
       * Los "self" se filtran igual en ambos, pero con la vara de medir de cada
       * medio: en series un cameo se cuela salvo que sume episodios, y en cine
       * no hay episodios que contar — lo que delata a un documental o una gala
       * es que la persona salga como ella misma sin personaje. Ahí el filtro es
       * seco, porque un actor no acumula cincuenta apariciones como sí mismo en
       * películas y sí en programas de entrevistas.
       *
       * Un `id` solo es único dentro de su medio (0067), así que lo visto se
       * recuerda por pareja: sin eso, una película y una serie con el mismo id
       * se comerían la una a la otra. */
      const seen = new Set<string>();
      const shows: Any[] = [];
      const selfish = (character: string) =>
        /^(self|himself|herself|themselves)\b/i.test(character.trim());

      const tvCredits = [...((d.tv_credits?.cast ?? []) as Any[])]
        .sort((a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0));
      for (const c of tvCredits) {
        if (c?.id == null || seen.has(`tv:${c.id}`)) continue;
        const character: string = c.character ?? "";
        if ((selfish(character) || !character) && (c.episode_count ?? 0) < 5) continue;
        seen.add(`tv:${c.id}`);
        shows.push({
          tmdb_id: c.id,
          kind: "tv",
          name: c.name ?? c.original_name ?? "Untitled",
          poster_path: c.poster_path ?? null,
          first_air_date: c.first_air_date || null,
          vote_average: c.vote_average ?? null,
          character: character || null,
          episode_count: c.episode_count ?? null,
        });
      }

      /* En cine cuentan las dos mitades del crédito, y la segunda es la razón
       * por la que esta página recibe visitas desde la ficha de una película:
       * quien dirige no sale en `cast`. Denis Villeneuve tiene 25 créditos de
       * dirección en `crew` y 18 en `cast`, casi todos menores o como sí mismo
       * — leer solo el reparto dejaba su ficha sin Dune, sin Arrival y sin
       * Blade Runner 2049, que es todo aquello por lo que alguien pulsa su
       * nombre.
       *
       * De `crew` solo dirección y guion: son los oficios que la ficha de una
       * película nombra, y los únicos por los que se busca a una persona. El
       * resto del equipo (montaje, cámara, "Thanks") llenaría la lista de
       * títulos en los que esa persona no es lo que fuiste a ver.
       *
       * `character` guarda el papel en el reparto y el OFICIO en el equipo: la
       * fila lo imprime igual, y "Director" bajo el título dice exactamente lo
       * que hay que decir. */
      // Por prioridad, no por el orden en que TMDB los liste: quien dirige y
      // además firma el guion aparece dos veces sobre la misma película, y de
      // las dos filas solo sobrevive la primera. Villeneuve salía como
      // "Screenplay" en Dune: Part Two — cierto, y no es por lo que se le busca.
      const DIRECTING_JOBS = ["Director", "Screenplay", "Writer"];
      const movieCredits = [
        ...((d.movie_credits?.cast ?? []) as Any[]).map((c) => ({ ...c, role: c.character ?? "" })),
        ...((d.movie_credits?.crew ?? []) as Any[])
          .filter((c) => DIRECTING_JOBS.includes(c?.job))
          .sort((a, b) => DIRECTING_JOBS.indexOf(a.job) - DIRECTING_JOBS.indexOf(b.job))
          .map((c) => ({ ...c, role: c.job as string })),
        // sort estable: con la misma popularidad, el orden de arriba se conserva.
      ].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

      for (const c of movieCredits) {
        if (c?.id == null || seen.has(`movie:${c.id}`)) continue;
        const role: string = c.role ?? "";
        /* Como sí misma y sin papel se cae; sin papel A SECAS no, al revés que
         * en series. Allí el recuento de episodios hace de salvavidas para el
         * crédito mal anotado, y aquí no hay ninguno: TMDB deja `character`
         * vacío en películas antiguas o poco editadas aunque el papel sea el
         * protagonista, y descartarlas por eso borraba media filmografía de
         * cualquiera con carrera larga. Un crédito sin papel se enseña sin
         * papel. */
        if (selfish(role)) continue;
        seen.add(`movie:${c.id}`);
        shows.push({
          tmdb_id: c.id,
          kind: "movie",
          name: c.title ?? c.original_title ?? "Untitled",
          poster_path: c.poster_path ?? null,
          first_air_date: c.release_date || null,
          vote_average: c.vote_average ?? null,
          character: role || null,
          episode_count: null,
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
        .eq("kind", "tv")
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
    // considered stale when the title's EPISODES are stale (episodes_refreshed_at
    // — not the detail stamp /title uses, which the discovery warm-up writes for
    // titles it never fetched an episode of) or the row count disagrees with the
    // season's announced episode_count (an episode was added since); both still
    // serve the cache and revalidate behind the response. Only a season with no
    // cached episodes blocks on TMDB.
    const mSeason = path.match(/^\/title\/(\d+)\/season\/(\d+)$/);
    if (mSeason) {
      const tmdbId = Number(mSeason[1]);
      const n = Number(mSeason[2]);
      const dbStarted = performance.now();
      const { data: existing } = await admin
        .from("titles").select("id, episodes_refreshed_at, imdb_id")
        .eq("kind", "tv").eq("tmdb_id", tmdbId).maybeSingle();
      const title = existing ?? (await refreshTitle(admin, apiKey, tmdbId)).title;
      const { data: season } = await admin
        .from("seasons").select("*, episodes(*)").eq("title_id", title.id).eq("number", n).maybeSingle();
      const dbMs = performance.now() - dbStarted;
      if (season) {
        const { episodes: nestedEpisodes, ...seasonRow } = season;
        const episodes = [...(nestedEpisodes ?? [])].sort((a: Any, b: Any) => a.episode_number - b.episode_number);
        if ((episodes ?? []).length) {
          const complete = seasonRow.episode_count == null || episodes.length >= seasonRow.episode_count;
          const stale = !hasFreshEpisodes(title) || !complete;
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
