// episode-refresh — scheduled edge function (P2-C8).
//
// For every DISTINCT followed title (any user): refresh the title row (status,
// dates, scores) and the latest two regular seasons' episodes from TMDB,
// upserting diffs into the metadata cache. Titles whose EPISODES were refreshed
// < 20h ago are skipped — `titles.episodes_refreshed_at`, which only this job
// and tmdb-proxy's whole-show fill write, never `last_refreshed_at`, which the
// discovery warm-up also writes (migration 0066). A daily schedule therefore
// self-heals without hammering TMDB. Rate-limited
// to ≤ 40 TMDB requests per 10s (fixed window — mirrors the unit-tested
// planner in app/src/domain/rateLimit.ts).
//
// IMDb ratings are NOT written here — scripts/imdb-ratings owns imdb_rating /
// imdb_votes, from IMDb's own published datasets. OMDb, which used to fill them
// nightly, turned out to be both incomplete and years out of date (it still
// serves Breaking Bad's "Ozymandias" as 10.0 from 251,146 votes; IMDb publishes
// 9.5 from 504,738), so it was removed rather than left to overwrite fresher
// numbers.
//
// AUTH: headless job — requires the service-role key as the bearer token.
//
// MANUAL MODES (query params; the schedule uses none of them):
//   ?force=1            ignore the staleness gate, recompute every followed title
//   ?allSeasons=1       refresh every regular season, not just the latest two —
//                       backfills the per-episode TMDB score on older seasons
//   ?backfillImdbIds=1  resolve titles.imdb_id for EVERY cached title that lacks
//                       one (not just the followed): without it the ratings
//                       importer cannot see a show at all. Run in rounds until
//                       job_runs reports remaining: 0.
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
import { needsEpisodeRefresh } from "./stale.ts";
import { pageAll } from "./paging.ts";
import { redactCredential, tmdbFetch } from "../_shared/tmdb.ts";

const TVMAZE = "https://api.tvmaze.com";
const LIMIT = 40;
const WINDOW_MS = 10_000;

/* Wall guard on a run's background work — every pass here is idempotent, so
   whatever is left over is picked up by the next run (or the next manual round).
   300s, down from 330s: the guard is only consulted between titles, so the margin
   it leaves has to cover one whole title's worst case. That case grew when
   enrichment joined the per-title work (more upstream calls), and a run really
   did get killed mid-title without logging. Capping every fetch
   (UPSTREAM_TIMEOUT_MS) bounds a title; this widens the margin that bound has to
   fit inside. Costs ~30s of throughput per run. */
const MAX_MS = 300_000;

/* Every upstream call is capped. Without this a third party that accepts the
   connection but never answers hangs `await fetch` forever: the refresh loop's
   wall guard is only checked BETWEEN titles, so one stalled request freezes the
   whole run until the platform kills the invocation — which also loses the
   job_runs bookkeeping written after the loop (observed 2026-07-30: a forced
   backfill run stopped ~2.5 min in having refreshed 90 titles and never logged).
   A rejected fetch, by contrast, is already handled everywhere: TMDB throws and
   the per-title try/catch records it, the TVmaze pass degrades to a no-op.
   10s is generous for all three (p99 well under 1s) while keeping the worst-case
   per-title cost bounded — a handful of fetches, so tens of seconds, comfortably
   inside the margin the guard leaves. */
const UPSTREAM_TIMEOUT_MS = 10_000;

// deno-lint-ignore no-explicit-any
type Any = any;

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
  // tmdbFetch owns the credential — header for a v4 read token, query string
  // for a v3 key — and keeps it out of the error a failed connection raises.
  // That matters more here than in tmdb-proxy: what this function throws is
  // written into job_runs, where it stays. See _shared/tmdb.ts.
  const res = await tmdbFetch(key, path, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }, console.error);
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

/** Air times already resolved from TVmaze, keyed `season x episode`, each with
 *  the TMDB day it was proven against.
 *
 *  The TMDB upsert writes every column in its payload, so without this it would
 *  stamp the 21:00 UTC placeholder over rows we had already dated properly —
 *  and the enrichment pass that follows is allowed to fail silently (TVmaze
 *  outage, rate limit, show dropped from their catalogue). That combination
 *  turns a momentary blip into real air times lost until the next successful
 *  run. Carrying the known values through the upsert keeps the placeholder for
 *  genuinely new episodes only.
 *
 *  `air_date` rides along because carrying a value through is only safe while
 *  TMDB still reports the same day for it (0060). If the day moved — a genuine
 *  reschedule, or a row the old number-only pairing mis-stamped — the instant is
 *  dropped and the episode goes back to the placeholder for the enrichment pass
 *  to re-pair. That is also what repairs the mis-stamped rows when TVmaze
 *  happens to be unreachable, since this runs before the pass, not after it. */
interface ResolvedTime {
  at: string;
  airDate: string | null;
  source: AirTimeSource;
}

async function keepResolvedTimes(
  admin: SupabaseClient,
  titleId: string,
): Promise<Map<string, ResolvedTime>> {
  // Paged and ordered: a long-running show has more episodes than the 1000 rows
  // PostgREST returns by default, and the ones past the cap are the newest —
  // the ones whose clocks this map exists to protect. See paging.ts.
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

/** TVmaze's episodes for a title, or an empty index when there is nothing to
 *  read (no IMDb id, not in their catalogue, upstream down) — all normal
 *  outcomes, and none of them fatal now that a platform rule can date the title
 *  on its own. */
async function tvmazeIndex(admin: SupabaseClient, title: Any): Promise<TvmazeIndex> {
  const showId = await tvmazeShowId(admin, title);
  if (!showId) return indexTvmaze([]);
  const res = await tvmaze(`/shows/${showId}/episodes`);
  if (!res.ok) return indexTvmaze([]);
  return indexTvmaze(await res.json());
}

/** Replace this title's 21:00 UTC placeholders with the real release instant —
 *  TVmaze's airstamp for a broadcaster, the platform's release rule for a
 *  streamer (resolveAirTime decides which, and on what day). Best-effort: a miss
 *  on both leaves the estimates and their marker untouched. */
async function enrichAirTimes(admin: SupabaseClient, titleId: string) {
  const { data: title } = await admin
    .from("titles").select("id, imdb_id, tvmaze_id, network, providers").eq("id", titleId).maybeSingle();
  if (!title) return;

  // What streams it beats where it once aired — see platform.ts.
  const platform = rulePlatform(title);

  const idx = await tvmazeIndex(admin, title);
  // Neither source has anything to say about this title.
  if (!idx.size && !platform) return;

  // Paged: unpaged, this read stopped at PostgREST's 1000th row, so on a show
  // long enough to pass that mark the episodes still to air — the whole point
  // of the pass — were never even considered. See paging.ts.
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
    // Instants, not strings: Postgres renders timestamptz with +00:00 where
    // toISOString() writes Z, so a textual diff would rewrite everything daily.
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

async function refreshTitle(
  admin: SupabaseClient,
  key: string,
  row: { id: string; tmdb_id: number },
  allSeasons = false,
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
  // plus the upserts).
  //
  // ?allSeasons=1 widens it to the whole show, for manual backfills only: the
  // per-episode TMDB score arrived with migration 0057 and is only ever written
  // by a season fetch, so every season older than the two this cron touches has
  // been sitting there without one. Do NOT put it on the schedule — it turns a
  // ~600-request nightly run into a ~2.500-request one to rewrite settled rows.
  //
  // Such a round is heavy enough that the runtime kills the isolate on its CPU
  // limit before the wall guard is ever consulted — locally, ~90s in, with no
  // job_runs row written. Harmless (every upsert is committed as it goes, and
  // re-running just re-refreshes), but it means these rounds are driven by the
  // DATA — count the seasons still missing a tmdb_vote_average — not by the run
  // log, which may never appear.
  const latest = allSeasons ? regular : regular.slice(0, 2);

  // Read once for the whole title, before any episode write touches it.
  const keep = await keepResolvedTimes(admin, row.id);

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
      //
      // "Known" is conditional on the day, though: an instant is only carried
      // through while TMDB still reports the same air_date for it. A reschedule
      // — or a row the pre-0060 number-only pairing stamped with another
      // episode's time — drops back to the placeholder, and the enrichment pass
      // below re-pairs it against the day.
      const held = keep.get(`${e.season_number}x${e.episode_number}`);
      const known = held && held.airDate && held.airDate === (e.air_date || null) ? held : null;
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
        // source behind the episode graph. IMDb ratings come from the weekly
        // dataset import (scripts/imdb-ratings), which owns those columns.
        tmdb_vote_average: e.vote_average ?? null,
        tmdb_vote_count: e.vote_count ?? null,
        // TMDB's bare day, kept as the anchor every TVmaze stamp is checked
        // against (0060) — the instant beside it may be TVmaze's.
        air_date: e.air_date || null,
        air_datetime: known ? known.at : airDatetime(e.air_date),
        air_time_source: known ? known.source : "estimated",
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

  // No IMDb pass here any more: scripts/imdb-ratings owns those columns, from
  // IMDb's own published datasets. See the header note.

  // Last, and deliberately not up with the title columns: this is the mark the
  // staleness gate reads back tomorrow, so it may only be written once the
  // episodes it claims to describe are actually in. Any throw above (a season
  // upsert, a TMDB season fetch) leaves it untouched, and the title comes back
  // at the head of the next run's queue instead of looking done. The enrich
  // failure just above is the one exception — it is caught, because a TVmaze
  // outage must not cost us the TMDB refresh we did land.
  const { error: me } = await admin
    .from("titles")
    .update({ episodes_refreshed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (me) throw new Error(`episodes_refreshed_at: ${me.message}`);
}

/* Resolve titles.imdb_id for every cached title that lacks one — ?backfillImdbIds=1.
 *
 * The ratings importer (scripts/imdb-ratings) matches our shows to IMDb's
 * datasets by imdb_id and nothing else, so a title without one is invisible to
 * it: no episode graph, no IMDb score on the sheet. Only the followed set ever
 * had one filled, because this cron and /title's refresh path are the only
 * writers and neither covers a title nobody follows — which left the other ~80%
 * of the cache unrateable.
 *
 * /tv/:id/external_ids is the cheapest endpoint TMDB has (a dozen ids, no
 * appends). The pass is idempotent and meant to be run in rounds: rows resolved
 * by an earlier round drop out of the query, so repeat until the count of titles
 * with a null imdb_id stops falling. Drive it by that count, NOT by this run's
 * `remaining` — these rounds are killed on the runtime's CPU limit long before
 * the wall guard, so the job_runs row often never gets written.
 *
 * THE QUEUE IS SHUFFLED, and that is not a detail. Shows TMDB genuinely has no
 * IMDb id for stay null forever, so they accumulate at the head of an ordered
 * queue and every later round spends its whole budget re-asking the same known
 * misses. Measured in production: yield per round fell 209 → 75 while a random
 * sample said ~65% of the remainder was still resolvable, and the first 20 rows
 * of the queue were misses to a title. Shuffling gives every title an even chance
 * of being reached, which is what makes the rounds converge instead of stalling
 * with hundreds of shows still unresolved.
 *
 * Titles are handled in small concurrent batches: done one at a time the pass
 * runs at the round-trip latency (~1/s) and leaves three quarters of the rate
 * limiter's budget unused, which turns a hand-driven backfill of a few thousand
 * titles into a whole evening of rounds.
 */
const BACKFILL_BATCH = 8;

async function backfillImdbIds(admin: SupabaseClient, key: string, maxMs: number) {
  const started = Date.now();
  const PAGE = 1000;
  const rows: Any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("titles")
      .select("id, tmdb_id")
      .eq("kind", "tv") // resuelve por /tv/:id — una película iría a 404
      .is("imdb_id", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`titles: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // Fisher-Yates — see the note above on why the order matters.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  let resolved = 0, none = 0, done = 0, hitGuard = false;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += BACKFILL_BATCH) {
    // Checked between batches, like the refresh loop above: throttle() already
    // holds the window, so a batch is bounded by one title's worst case times
    // the batch size, well inside the margin MAX_MS leaves.
    if (Date.now() - started > maxMs) { hitGuard = true; break; }
    const batch = rows.slice(i, i + BACKFILL_BATCH);
    const outcomes = await Promise.all(batch.map(async (t: Any) => {
      try {
        const d = await tmdb(key, `/tv/${t.tmdb_id}/external_ids`);
        const imdbId = d?.imdb_id || null;
        if (!imdbId) return "none"; // TMDB has no IMDb id for this show
        const { error } = await admin.from("titles").update({ imdb_id: imdbId }).eq("id", t.id);
        if (error) throw new Error(error.message);
        return "resolved";
      } catch (err) {
        errors.push(`${t.tmdb_id}: ${redactCredential(String(err))}`);
        return "error";
      }
    }));
    for (const o of outcomes) {
      if (o === "resolved") resolved++;
      else if (o === "none") none++;
    }
    done += batch.length;
  }
  return {
    missing: rows.length,
    resolved,
    noImdbId: none,
    errors: errors.length,
    hitGuard,
    remaining: rows.length - done,
    sample: errors.slice(0, 5),
  };
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
  // Manual backfill of the per-episode TMDB score across the seasons the daily
  // run never touches. See refreshTitle — not for the schedule.
  const allSeasons = params.get("allSeasons") === "1";
  // Manual pass, run in rounds until `remaining` is 0. See backfillImdbIds.
  const backfillIds = params.get("backfillImdbIds") === "1";

  // One queryable row per run/exit (job_runs, migration 0029) so a silently-
  // failing daily job is visible (edge logs are console-only + ~1 day on free
  // tier). Best-effort — never fail the run on the log write.
  const startedAt = new Date().toISOString();
  const logRun = (ok: boolean, summary: unknown, job = "episode-refresh") =>
    admin.from("job_runs").insert({
      job,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok,
      summary,
    }).then(() => {}, () => {});

  // The imdb_id pass shares nothing with the refresh below — a different set of
  // titles (every cached one, not the followed) and a different endpoint — so it
  // short-circuits here rather than threading a mode through the whole run. Same
  // respond-now-work-later shape, under its own job name.
  if (backfillIds) {
    const work = backfillImdbIds(admin, tmdbKey, MAX_MS).then(
      (summary) => {
        console.log(`imdb-id-backfill done: ${summary.resolved} resolved, ${summary.remaining} left`);
        return logRun(summary.errors === 0, summary, "imdb-id-backfill");
      },
      (err) => logRun(false, { error: redactCredential(String(err)) }, "imdb-id-backfill"),
    );
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as Any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work);
    else await work;
    return new Response(JSON.stringify({ job: "imdb-id-backfill", processing: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  // distinct followed titles (service role sees all users). The !inner embed
  // filters titles to those with ≥1 followed entry — parent rows stay unique,
  // and no giant `.in(id, …)` URI is needed. Ordered oldest-refreshed first so
  // the wall guard becomes a rotating window (no title starves), and paged past
  // PostgREST's 1000-row cap so the whole followed set is considered. `id` is
  // the tiebreaker: episodes_refreshed_at ties exactly across the
  // never-refreshed (NULL) cohort, and untied pages can skip/duplicate rows
  // across boundaries.
  //
  // Ordered and gated on episodes_refreshed_at, never last_refreshed_at: the
  // latter only means the title row's detail was refetched, and the discovery
  // warm-up refetches detail for the whole popular-now pool at 04:40 without
  // touching an episode. Keying off it made this run skip every followed title
  // in that pool, daily and indefinitely (migration 0066, stale_test.ts).
  const PAGE = 1000;
  const titles: Any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: te } = await admin
      .from("titles")
      .select("id, tmdb_id, status, episodes_refreshed_at, library_entries!inner(followed)")
      // Solo series: este cron refresca por /tv/:id y mantiene temporadas y
      // episodios. Una película no tiene ninguna de las dos cosas, y su fila de
      // episodio la mantiene el trigger de 0067 desde el propio título.
      .eq("kind", "tv")
      .eq("library_entries.followed", true)
      .order("episodes_refreshed_at", { ascending: true, nullsFirst: true })
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

  // The gate itself lives in stale.ts, with its thresholds and its tests.
  const now = Date.now();
  const stale = force ? titles : titles.filter((t: Any) => needsEpisodeRefresh(t, now));

  // Respond immediately and refresh in the background (EdgeRuntime.waitUntil)
  // so the gateway's request timeout never truncates a big backfill. The wall
  // guard (MAX_MS) stops before the runtime's hard limit; leftovers stay stale
  // and the next scheduled run picks them up (refreshTitle is idempotent).
  const started = Date.now();

  const work = (async () => {
    let refreshed = 0;
    let hitGuard = false;
    const errors: string[] = [];
    for (const t of stale) {
      if (Date.now() - started > MAX_MS) { hitGuard = true; break; }
      try {
        await refreshTitle(admin, tmdbKey, t, allSeasons);
        refreshed++;
      } catch (err) {
        errors.push(`${t.tmdb_id}: ${redactCredential(String(err))}`);
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
      // Marks the manual whole-show rounds apart from the nightly two-season one.
      ...(allSeasons ? { allSeasons: true } : {}),
      errors: errors.length,
      hitGuard,
      remaining: hitGuard ? stale.length - refreshed - errors.length : 0,
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
