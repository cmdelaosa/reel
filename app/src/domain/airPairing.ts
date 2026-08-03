/* Which TVmaze broadcast instant, if any, is allowed to time one of our
   episodes.
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
 * So the rule is deliberately narrow: **TVmaze may set the time of day, never
 * the day**. TMDB's `air_date` is the anchor, and a stamp that doesn't land on
 * it isn't our episode's, whatever number it carries.
 *
 * Pairing by day rather than by number also does better than merely refusing
 * the bad match: TVmaze publishes `airdate`, the local broadcast day, next to
 * the stamp, so a shifted catalogue can still be re-aligned. Our E10 asks for
 * 2026-07-09 and finds TVmaze's `30x8` — the same episode under a different
 * number — and keeps a real clock instead of falling back to the placeholder.
 *
 * Nothing here does timezone arithmetic, and it must stay that way: `airdate`
 * and TMDB's `air_date` are both the broadcaster's local day, so they compare
 * as strings. The `airstamp` is absolute (DST already resolved) and is only
 * ever carried through, never decomposed.
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
