/* Watch-history grouping — pure. Buckets watched episodes by LOCAL calendar day
   (reusing calendar.ts's DST-safe dayOffset) and orders the buckets most-recent
   first. Unlike the calendar feed this is entirely in the past, so every offset
   is <= 0 and there's no "Later" tail. */

import { dayOffset } from "@/domain/calendar";

export interface WatchedEpish {
  watched_at: string;
}

/** [dayOffset, rows] with the most recent day first. Rows keep the order they
 *  arrive in (the query already returns them newest-first within a day). */
export function groupHistory<T extends WatchedEpish>(rows: T[], now: Date): [number, T[]][] {
  const map = new Map<number, T[]>();
  for (const r of rows) {
    const off = dayOffset(r.watched_at, now);
    const list = map.get(off);
    if (list) list.push(r);
    else map.set(off, [r]);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

/** Today / Yesterday for the two most recent days; FULL DATE (upper) before. */
export function historyDayLabel(off: number, iso: string): string {
  if (off === 0) return "Today";
  if (off === -1) return "Yesterday";
  return new Date(iso)
    .toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" })
    .toUpperCase();
}
