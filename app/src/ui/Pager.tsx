import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* Section pager — the "1 / 3" counter plus chip arrows used in Discover's
   section header. usePager slices the list to the current page and hands back
   the ready-to-place controls; render `pager` at the right edge of the section
   header (it carries margin-left auto). Null when everything fits one page. */

export function usePager<T>(items: T[], pageSize: number): { shown: T[]; start: number; pager: React.ReactNode } {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const shown = items.slice(start, start + pageSize);
  if (pageCount <= 1) return { shown, start, pager: null };
  return {
    shown,
    start,
    pager: (
      <div className="flex items-center gap-1.5" role="group" aria-label="Pagination" style={{ marginLeft: "auto" }}>
        <span className="mute" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {current + 1} / {pageCount}
        </span>
        <button className="chip" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
          <ChevronLeft size={14} />
        </button>
        <button className="chip" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
          <ChevronRight size={14} />
        </button>
      </div>
    ),
  };
}
