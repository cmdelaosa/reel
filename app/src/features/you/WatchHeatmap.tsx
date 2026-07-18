import { useEffect, useMemo, useRef } from "react";
import { useWatchHeatmap } from "@/lib/stats";
import { dateLocale, isEs, t as tr } from "@/lib/i18n";

/* GitHub-style contribution grid of the days you watched episodes — weeks as
   columns, Monday-first rows. Hidden entirely while loading or if the RPC is
   missing (e.g. hosted DB behind on migrations).

   Pass `userId` to render a friend's grid instead of your own (friend profile);
   the friend-read RLS on watch_events is what gates it. */

/* A rolling year, not year-to-date: 53 columns is the smallest count that can
   hold 365 days once they're snapped to Monday-first weeks (52 weeks = 364 days
   plus the partial current week). The RPC window below is WEEKS * 7, which must
   stay >= the span the grid walks or the leftmost column loses its data. */
const WEEKS = 53;

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function WatchHeatmap({ userId }: { userId?: string }) {
  const { data, isPending, isError } = useWatchHeatmap(WEEKS * 7, userId);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const grid = useMemo(() => {
    if (!data) return null;
    const counts = new Map(data.map((r) => [r.day, r.n]));
    const max = Math.max(1, ...counts.values());

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    // Back to the Monday that starts the window (Monday-first: (getDay()+6)%7).
    start.setDate(start.getDate() - (WEEKS - 1) * 7 - ((today.getDay() + 6) % 7));

    const cells: { key: string; label: string; n: number; level: number; future: boolean }[] = [];
    const months: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      for (let r = 0; r < 7; r++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + r);
        const key = localIso(d);
        const n = counts.get(key) ?? 0;
        const future = d > today;
        if (r === 0 && d.getMonth() !== lastMonth) {
          // Skip a label in the first fortnight-wide slot only if it would collide.
          if (lastMonth === -1 || w >= 2) months.push({ week: w, label: d.toLocaleDateString(dateLocale(), { month: "short" }) });
          lastMonth = d.getMonth();
        }
        cells.push({
          key,
          label: `${n} ${n === 1 ? (isEs() ? "episodio" : "episode") : isEs() ? "episodios" : "episodes"} · ${d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })}`,
          n,
          level: n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)),
          future,
        });
      }
    }
    return { cells, months };
  }, [data]);

  // When the year is too wide to fit (narrow screens), open on the current week
  // rather than a year ago — the recent end is the part worth seeing.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [grid]);

  if (isPending || isError || !grid) return null;

  const weekdays = isEs() ? ["L", "", "X", "", "V", "", ""] : ["M", "", "W", "", "F", "", ""];
  // Third person on a friend's profile, where every other heading reads that
  // way ("Their top ratings") and a bare "Watch activity" would be ambiguous.
  const heading = userId ? tr("Their watch activity") : tr("Watch activity");

  // Month labels share the grid's column track so each one sits over the week
  // it names, gaps included.
  const weekColumns = `repeat(${WEEKS}, minmax(var(--heat-min), 1fr))`;

  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow">{heading}</div>
      <div className="card p-4 flex flex-col gap-2">
        {/* One scroll container around months + gutter + cells, so they can
            never drift out of sync when a year is too wide to fit. */}
        <div className="heatmap" ref={scrollerRef}>
          <div className="heatmap-board">
            <div className="heatmap-months" style={{ gridTemplateColumns: weekColumns }}>
              {grid.months.map((m) => (
                <span key={m.week} style={{ gridColumnStart: m.week + 1 }}>{m.label}</span>
              ))}
            </div>
            <div className="heatmap-wd" aria-hidden>
              {weekdays.map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="heatmap-grid" role="img" aria-label={heading} style={{ gridTemplateColumns: weekColumns }}>
              {grid.cells.map((c) => (
                <div
                  key={c.key}
                  className={`heatmap-cell${c.future ? " future" : c.level ? ` l${c.level}` : ""}`}
                  title={c.future ? undefined : c.label}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="heatmap-legend">
          <span style={{ marginRight: 2 }}>{tr("Less")}</span>
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heatmap-cell${l ? ` l${l}` : ""}`} />)}
          <span style={{ marginLeft: 2 }}>{tr("More")}</span>
        </div>
      </div>
    </div>
  );
}
