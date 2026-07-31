import { useState } from "react";
import { t as tr } from "@/lib/i18n";

/* Progressive reveal for a section's list — the app's one paging idiom, the
   same "Show more" Discover grew its grid with. useShowMore slices the list to
   what has been revealed so far and hands back the ready-to-place button;
   render `more` after the grid, not in the section header. Null once
   everything is shown. */

/* `atLeast` reveals at least that many without a click, for the caller that
   arrives pointing at a specific item (a notification deep-linking into the
   activity feed) and cannot ask the reader to press "Show more" to find it. */
export function useShowMore<T>(
  items: T[],
  pageSize: number,
  atLeast = 0,
): { shown: T[]; more: React.ReactNode } {
  const [count, setCount] = useState(pageSize);
  const reveal = Math.max(count, atLeast);
  const shown = items.slice(0, reveal);
  if (reveal >= items.length) return { shown, more: null };
  return {
    shown,
    more: (
      <div className="show-more">
        <button className="btn btn-outline" onClick={() => setCount((c) => c + pageSize)}>
          {tr("Show more")}
        </button>
      </div>
    ),
  };
}
