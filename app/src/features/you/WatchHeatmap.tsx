import { useMemo } from "react";
import { useWatchHeatmap } from "@/lib/stats";
import { dateLocale, isEs, t as tr } from "@/lib/i18n";

/* GitHub-style contribution grid of the days you watched episodes — weeks as
   columns, Monday-first rows, ~6 months back. Hidden entirely while loading or
   if the RPC is missing (e.g. hosted DB behind on migrations).

   Pass `userId` to render a friend's grid instead of your own (friend profile);
   the friend-read RLS on watch_events is what gates it. */

const WEEKS = 26;

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function WatchHeatmap({ userId }: { userId?: string }) {
  const { data, isPending, isError } = useWatchHeatmap(WEEKS * 7, userId);

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

  if (isPending || isError || !grid) return null;

  const weekdays = isEs() ? ["L", "", "X", "", "V", "", ""] : ["M", "", "W", "", "F", "", ""];
  // Third person on a friend's profile, where every other heading reads that
  // way ("Their top ratings") and a bare "Watch activity" would be ambiguous.
  const heading = userId ? tr("Their watch activity") : tr("Watch activity");

  return (
    // .taste-col: subgrid column, so this card height-matches the taste profile
    // panel it sits next to (see .taste-grid).
    <div className="taste-col">
      <div className="eyebrow">{heading}</div>
      <div className="card p-4 flex flex-col gap-2">
        <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, marginLeft: 26 }}>
          {grid.months.map((m) => (
            <span key={m.week} style={{ gridRowStart: 1, gridColumnStart: m.week + 1 }}>{m.label}</span>
          ))}
        </div>
        <div className="heatmap">
          <div className="heatmap-wd" aria-hidden>
            {weekdays.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="heatmap-grid" role="img" aria-label={heading}>
            {grid.cells.map((c) => (
              <div
                key={c.key}
                className={`heatmap-cell${c.future ? " future" : c.level ? ` l${c.level}` : ""}`}
                title={c.future ? undefined : c.label}
              />
            ))}
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
