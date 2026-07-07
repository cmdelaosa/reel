/* Tonight derivations — pure. Fresh vs continue-watching split of the up-next
   list, and the premieres-soon filter. All date math uses absolute epoch
   milliseconds, so DST wall-clock shifts cannot skew the windows. */

export const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PREMIERE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface UpNextish {
  air_datetime: string | null;
  last_watched_at: string | null;
}

/** Fresh = up-next episode aired within the last 7 days (newest first).
 *  Continue = the rest, by most recent watch activity (nulls last). */
export function splitTonight<T extends UpNextish>(items: T[], now: Date): { fresh: T[]; cont: T[] } {
  const nowMs = now.getTime();
  const fresh: T[] = [];
  const cont: T[] = [];
  for (const it of items) {
    const air = it.air_datetime ? new Date(it.air_datetime).getTime() : null;
    if (air != null && air <= nowMs && nowMs - air <= FRESH_WINDOW_MS) fresh.push(it);
    else cont.push(it);
  }
  fresh.sort((a, b) => new Date(b.air_datetime!).getTime() - new Date(a.air_datetime!).getTime());
  cont.sort((a, b) => {
    const la = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
    const lb = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
    return lb - la;
  });
  return { fresh, cont };
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
