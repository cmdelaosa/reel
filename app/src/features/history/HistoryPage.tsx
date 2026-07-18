import { useEffect, useMemo, useRef } from "react";
import { groupHistory, historyDayLabel } from "@/domain/history";
import { useWatchHistory } from "@/lib/history";
import { dateLocale, isEs, t as tr } from "@/lib/i18n";
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
      <header className="mq-header">
        <h1 className="mq-h1">{tr("History")}</h1>
        <p className="dim mq-sub">
          {isEs()
            ? "Todo lo que has visto, lo más reciente primero — con la hora exacta en que lo marcaste."
            : "Everything you've watched, newest first — with the exact time you marked it."}
        </p>
      </header>

      {isPending ? (
        <p className="dim">{tr("Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="dim">
          {isEs()
            ? "Aún no has visto nada. Los episodios que marques como vistos aparecen aquí."
            : "Nothing watched yet. Episodes you mark as watched show up here."}
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
