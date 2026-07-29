/* Calendar feed grouping — pure. Mirrors the prototype's episodeFeed grouping:
   per-day buckets for local-day offsets 0..6 plus past days, and a single
   "Later" bucket beyond 6 days. Day offsets use whole CALENDAR days, so a
   23/25-hour DST day still counts as exactly one.

   Every entry point takes an optional IANA `tz` (undefined = the runtime's own
   zone). It must be the same zone the rows are *formatted* in — callers pass
   airTimeZone() from lib/region.ts — or an episode files under "Today" while
   its own row prints tomorrow's date. */

export interface FeedEpish {
  air_datetime: string | null;
}

/** Calendar date of an instant in `tz`, as YYYY-MM-DD. en-CA with explicit
 *  numeric parts is ISO order in every ICU build. */
const dayKey = (d: Date, tz?: string) =>
  d.toLocaleDateString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

/** Both dates land on midnight UTC of their own calendar day, so subtracting
 *  them yields whole days regardless of the offsets in play. */
const startOfDay = (d: Date, tz?: string) => Date.parse(`${dayKey(d, tz)}T00:00:00Z`);

/** Whole calendar-day offset of `iso` relative to `now` (0 = today), in `tz`. */
export function dayOffset(iso: string, now: Date, tz?: string): number {
  return Math.round((startOfDay(new Date(iso), tz) - startOfDay(now, tz)) / 86_400_000);
}

export interface GroupedFeed<T> {
  /** [dayOffset, rows] sorted ascending (past first). */
  days: [number, T[]][];
  /** Beyond 6 days out. */
  later: T[];
}

export function groupFeed<T extends FeedEpish>(rows: T[], now: Date, tz?: string): GroupedFeed<T> {
  const map = new Map<number, T[]>();
  const later: T[] = [];
  for (const r of rows) {
    if (!r.air_datetime) continue;
    const off = dayOffset(r.air_datetime, now, tz);
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
 *  `locale` follows the UI language (undefined = browser default English);
 *  `tz` must match the one the offsets were bucketed with. */
export function dayLabel(off: number, iso: string, locale?: string, tz?: string): string {
  const es = locale?.startsWith("es") ?? false;
  const d = new Date(iso);
  if (off === 0) return es ? "Hoy" : "Today";
  if (off === 1) return es ? "Mañana" : "Tomorrow";
  if (off > 1) return d.toLocaleDateString(locale, { weekday: "long", timeZone: tz });
  return d
    .toLocaleDateString(locale, { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: tz })
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
export function clusterFeed<T extends ClusterRow>(rows: T[], now: Date, tz?: string): FeedCluster<T>[] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.air_datetime) continue;
    const key = `${r.title_id}|${dayOffset(r.air_datetime, now, tz)}`;
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
