/* Calendar feed grouping — pure. Mirrors the prototype's episodeFeed grouping:
   per-day buckets for local-day offsets 0..6 plus past days, and a single
   "Later" bucket beyond 6 days. Day offsets use LOCAL calendar days (midnight
   boundaries), so a 23/25-hour DST day still counts as exactly one day. */

export interface FeedEpish {
  air_datetime: string | null;
}

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole local-calendar-day offset of `iso` relative to `now` (0 = today). */
export function dayOffset(iso: string, now: Date): number {
  const diff = startOfLocalDay(new Date(iso)) - startOfLocalDay(now);
  return Math.round(diff / 86_400_000); // round absorbs DST 23h/25h days
}

export interface GroupedFeed<T> {
  /** [dayOffset, rows] sorted ascending (past first). */
  days: [number, T[]][];
  /** Beyond 6 days out. */
  later: T[];
}

export function groupFeed<T extends FeedEpish>(rows: T[], now: Date): GroupedFeed<T> {
  const map = new Map<number, T[]>();
  const later: T[] = [];
  for (const r of rows) {
    if (!r.air_datetime) continue;
    const off = dayOffset(r.air_datetime, now);
    if (off >= 7) {
      later.push(r);
      continue;
    }
    const list = map.get(off);
    if (list) list.push(r);
    else map.set(off, [r]);
  }
  return { days: [...map.entries()].sort((a, b) => a[0] - b[0]), later };
}

/** Today / Tomorrow / weekday for 0..6; FULL DATE (upper) in the past.
 *  `locale` follows the UI language (undefined = browser default English). */
export function dayLabel(off: number, iso: string, locale?: string): string {
  const es = locale?.startsWith("es") ?? false;
  const d = new Date(iso);
  if (off === 0) return es ? "Hoy" : "Today";
  if (off === 1) return es ? "Mañana" : "Tomorrow";
  if (off > 1) return d.toLocaleDateString(locale, { weekday: "long" });
  return d
    .toLocaleDateString(locale, { weekday: "short", month: "long", day: "numeric", year: "numeric" })
    .toUpperCase();
}

/** Premiere/finale badge — the only two the product ships. */
export function episodeBadge(e: { is_premiere: boolean; is_finale: boolean; season_number: number }): string | null {
  if (e.is_premiere) return e.season_number === 1 ? "Series premiere" : "Season premiere";
  if (e.is_finale) return "Season finale";
  return null;
}

export interface ClusterRow extends FeedEpish {
  title_id: string;
  season_number: number;
  episode_number: number;
}

/** A show's episodes sharing one local day. `count === 1` renders as a normal
 *  single row; `count > 1` collapses into a batch led by `lead` (the lowest
 *  season/episode) with `rest` revealed on expand. `last` is the highest
 *  episode — the "mark up to here" target for a binged drop. */
export interface FeedCluster<T> {
  lead: T;
  rest: T[];
  last: T;
  count: number;
}

/** Group a chronologically-sorted feed by (show, local day), preserving the
 *  order of each cluster's first-seen row. Mirrors TV Time's same-day collapse:
 *  a full-season drop becomes one row, a weekly show stays one row per day.
 *  Rows without an air_datetime are dropped (they never render). */
export function clusterFeed<T extends ClusterRow>(rows: T[], now: Date): FeedCluster<T>[] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.air_datetime) continue;
    const key = `${r.title_id}|${dayOffset(r.air_datetime, now)}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else {
      groups.set(key, [r]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const eps = groups
      .get(key)!
      .slice()
      .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
    return { lead: eps[0], rest: eps.slice(1), last: eps[eps.length - 1], count: eps.length };
  });
}
