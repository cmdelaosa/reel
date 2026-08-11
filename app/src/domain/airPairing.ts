/* Which instant an episode is actually released, and which source is allowed to
 * say so.
 *
 * TMDB gives a bare day (`air_date`, no hour, no zone); TVmaze gives a real
 * `airstamp`, and that clock is the only reason we call TVmaze at all — see
 * migration 0051. The ingest used to pair the two catalogues on season ×
 * episode number and nothing else, which quietly assumes they count episodes
 * the same way. They don't. TMDB's Hot Ones season 30 carries thirteen
 * episodes, TVmaze's eleven (it lists neither the Tim Howard opener nor the
 * J Balvin), so from there on TVmaze's `30x10` is our E12 — and every episode
 * of that season got stamped with a later one's time, fourteen days out at the
 * end, where two air dates ended up printed twice.
 *
 * That is not a wrong hour, it's a wrong DAY, and `air_datetime` is what the
 * alert window (0059), the aired / mark-up-to / up-next gates and the whole
 * calendar key off — an episode dated two weeks late is one nobody is told
 * about and nobody can mark as watched until the date passes.
 *
 * So the rule was, and mostly still is: **TVmaze may set the time of day, never
 * the day**. TMDB's `air_date` is the anchor, and a stamp that doesn't land on
 * it isn't our episode's, whatever number it carries.
 *
 * Pairing by day rather than by number also does better than merely refusing
 * the bad match: TVmaze publishes `airdate`, the local broadcast day, next to
 * the stamp, so a shifted catalogue can still be re-aligned. Our E10 asks for
 * 2026-07-09 and finds TVmaze's `30x8` — the same episode under a different
 * number — and keeps a real clock instead of falling back to the placeholder.
 *
 * ── streaming (0065) ────────────────────────────────────────────────────────
 * Two things about that rule were wrong for streaming, and Silo and Ted Lasso
 * showed both.
 *
 * First, TVmaze only knows a clock for scheduled broadcasters. For a streamer
 * its `airtime` is empty and the `airstamp` it publishes is a noon-UTC filler —
 * so Stranger Things was printing "14:00" as a broadcast fact. An `airstamp`
 * is therefore only a real clock when `airtime` is non-empty; otherwise TVmaze
 * is telling us a DAY and nothing more.
 *
 * Second, on Apple TV+ the two catalogues disagree about the day itself. Apple
 * drops at 21:00 Pacific the evening before the release day (= 00:00 Eastern on
 * it), and TMDB's contributors enter that Pacific date: every episode of Silo
 * and of Ted Lasso season 3–4 is filed one day before TVmaze's. Anchored on
 * TMDB and stapled to the 21:00 UTC placeholder, Ted Lasso 4x02 landed on
 * Aug 11 at 23:00 in Madrid — a day before it exists.
 *
 * So the day may now move, in exactly one direction and under three locks at
 * once: the platform must be one we hold a release rule for, TVmaze must count
 * the same episodes in that season as TMDB, and no episode in that season may
 * sit more than one day off (alignedSeasons). The count is what kills Hot Ones
 * at the root — thirteen against eleven — because a numbering drift always
 * starts as a count mismatch, and a weekly drift shows up as seven days, not
 * one.
 *
 * Where there is no TVmaze at all, the release day is inferred from the weekday
 * instead: Apple releases on Wednesdays and Fridays, so a TMDB date on the
 * Tuesday or Thursday before is the Pacific evening of one. Measured against
 * TVmaze over 536 episodes of 17 Apple shows, that call is right 531 times.
 *
 * Nothing here does timezone arithmetic on TVmaze's data, and it must stay that
 * way: `airdate` and TMDB's `air_date` are both the broadcaster's local day, so
 * they compare as strings, and `airstamp` is absolute (DST already resolved) and
 * is only ever carried through, never decomposed. The one place a zone is
 * resolved is the platform table, where a rule is a wall clock BY DEFINITION —
 * "midnight Eastern" — and Intl is asked what instant that was on that date.
 *
 * Hand-mirrored into supabase/functions/{tmdb-proxy,episode-refresh} — the two
 * ingest paths run in Deno and can't import from app/. airPairing.mirror.test.ts
 * compares the block below against both copies, so an edit here fails until it
 * lands in all three.
 */

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
 *  Keyed by TMDB's `networks[0].name`, which is what titles.network holds.
 *  Deliberately short: Max, Hulu and the rest vary per title or per region, and
 *  an invented hour presented as fact is the bug this file exists to prevent.
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

export const platformRelease = (network: string | null | undefined): PlatformRelease | null =>
  (network && PLATFORM_RELEASE[network]) || null;

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
