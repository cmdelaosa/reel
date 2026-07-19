import { useEffect, useMemo, useRef } from "react";
import { groupHistory, historyDayLabel } from "@/domain/history";
import { useWatchHistory } from "@/lib/history";
import { dateLocale, t as tr } from "@/lib/i18n";
import { HistoryEpRow } from "@/features/history/HistoryEpRow";

/* History — every watched episode, newest first, grouped by the local day it
   was marked, with the exact time on each row. Pages backwards through time via
   an IntersectionObserver sentinel at the bottom of the feed. */

export default function HistoryPage() {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useWatchHistory();
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(() => (data?.pages ?? []).flat(), [data]);
  const days = useMemo(() => groupHistory(rows, now), [rows, now]);

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="screen mq-page cal-page">
      <h1 className="sr-only">{tr("History")}</h1>

      {isPending ? (
        <p className="dim">{tr("Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="dim">
          {tr("Nothing watched yet. Episodes you mark as watched show up here.")}
        </p>
      ) : (
        <div className="cal-feed">
          {days.map(([off, list]) => (
            <div key={off} className="cal-day">
              <div className="cal-daysep"><span>{historyDayLabel(off, list[0].watched_at, dateLocale())}</span></div>
              {list.map((ep) => (
                <HistoryEpRow key={ep.watch_event_id} ep={ep} />
              ))}
            </div>
          ))}
          <div ref={sentinel} className="cal-sentinel">
            {hasNextPage || isFetchingNextPage ? tr("Loading more…") : tr("That's the start of your history.")}
          </div>
        </div>
      )}
    </div>
  );
}
