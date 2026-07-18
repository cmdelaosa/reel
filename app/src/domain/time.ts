/* Relative-time label — pure. "now" / "2h ago" / "yesterday" / "3 days ago" /
   short date beyond a week. */

export function relativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const es = locale?.startsWith("es") ?? false;
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const sec = Math.floor(diffMs / 1000);

  if (sec < 45) return es ? "ahora mismo" : "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return es ? `hace ${min}m` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return es ? `hace ${hr}h` : `${hr}h ago`;

  // Day granularity by local calendar day, so "yesterday" is stable across DST.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(new Date(then))) / 86_400_000);
  if (days <= 1) return es ? "ayer" : "yesterday";
  if (days < 7) return es ? `hace ${days} días` : `${days} days ago`;
  return new Date(then).toLocaleDateString(locale, { month: "short", day: "numeric" });
}
