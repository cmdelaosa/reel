/* Tonight derivations — pure. Continue-watching ordering of the up-next list,
   and the premieres-soon filter. All date math uses absolute epoch
   milliseconds, so DST wall-clock shifts cannot skew the windows. */

export const FRESH_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
export const PREMIERE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface UpNextish {
  air_datetime: string | null;
  last_watched_at: string | null;
}

/** Effective activity instant used to order continue-watching: the more recent
 *  of (a) the last time an episode of this show was marked watched and (b) the
 *  air time of its next unwatched aired episode. Both are present in practice —
 *  up-next rows always have a watched episode and an aired next one — but we
 *  fall back to 0 defensively. A newly aired episode of a show you were caught
 *  up on therefore resurfaces it as if you'd just been active, counting from
 *  that episode's air date rather than from your (older) last watch. */
export function activityMs(it: UpNextish): number {
  const watched = it.last_watched_at ? new Date(it.last_watched_at).getTime() : 0;
  const air = it.air_datetime ? new Date(it.air_datetime).getTime() : 0;
  return Math.max(watched, air);
}

/** Continue-watching order: shows by most recent effective activity, newest
 *  first. The first entry is the Tonight hero; the rest fill the rail. */
export function orderByActivity<T extends UpNextish>(items: T[]): T[] {
  return [...items].sort((a, b) => activityMs(b) - activityMs(a));
}

export interface Premiereish {
  status: string;
  next_air_datetime: string | null;
  first_air_date: string | null;
}

/** Followed upcoming titles premiering within the next 60 days, soonest first.
 *  Premiere instant = first future episode when cached, else the title's
 *  first_air_date (date-only → treated as 21:00 UTC, the cache placeholder). */
export function premieresSoon<T extends Premiereish>(library: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return library
    .filter((s) => s.status === "upcoming")
    .map((s) => ({ s, at: premiereMs(s) }))
    .filter((x): x is { s: T; at: number } => x.at != null && x.at > nowMs && x.at - nowMs <= PREMIERE_WINDOW_MS)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.s);
}

export function premiereMs(s: Premiereish): number | null {
  if (s.next_air_datetime) return new Date(s.next_air_datetime).getTime();
  if (s.first_air_date) return new Date(`${s.first_air_date}T21:00:00Z`).getTime();
  return null;
}

/** Calendar-feed episodes that aired within the last 5 days (the FRESH window),
 *  newest first. Feed-driven so it surfaces every recently-aired episode of a
 *  followed show — not just the next-to-watch one per show. */
export function recentlyAired<T extends { air_datetime: string }>(feed: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return feed
    .map((e) => ({ e, at: new Date(e.air_datetime).getTime() }))
    .filter((x) => x.at <= nowMs && nowMs - x.at <= FRESH_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .map((x) => x.e);
}

export interface PremiereFeedish {
  title_id: string;
  air_datetime: string;
  is_premiere: boolean;
}

/** Premiere episodes (episode 1 — a new series or a new season) from the
 *  calendar feed landing within the next 60 days, soonest first, deduped to one
 *  row per show. Feed-driven so "Premieres soon" renders the same rows as the
 *  calendar (season/episode, exact time, days-away countdown). */
export function soonPremieres<T extends PremiereFeedish>(feed: T[], now: Date): T[] {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  return feed
    .filter((e) => e.is_premiere)
    .map((e) => ({ e, at: new Date(e.air_datetime).getTime() }))
    .filter((x) => x.at > nowMs && x.at - nowMs <= PREMIERE_WINDOW_MS)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.e)
    .filter((e) => !seen.has(e.title_id) && (seen.add(e.title_id), true));
}
