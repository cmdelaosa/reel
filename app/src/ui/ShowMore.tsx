import { useState } from "react";
import { t as tr } from "@/lib/i18n";

/* Progressive reveal for a section's list — the app's one paging idiom, the
   same "Show more" Discover grew its grid with. useShowMore slices the list to
   what has been revealed so far and hands back the ready-to-place button;
   render `more` after the grid, not in the section header. Null once
   everything is shown. */

/* `atLeast` reveals at least that many without a click, for the caller that
   arrives pointing at a specific item (a notification deep-linking into the
   activity feed) and cannot ask the reader to press "Show more" to find it.
   It RAISES the count rather than being max()'d into the result: revealing has
   to be one-way. Derived, it would un-reveal the moment the caller's reason for
   it went away — and that caller drops its deep-link param on a timer, which
   would have collapsed the list under the reader mid-read. */
export function useShowMore<T>(
  items: T[],
  pageSize: number,
  atLeast = 0,
): { shown: T[]; more: React.ReactNode } {
  const [count, setCount] = useState(pageSize);
  // Adjusting state during render (React's documented pattern for "derive from
  // props"): it re-renders before committing, so nothing flashes.
  if (atLeast > count) setCount(atLeast);
  const shown = items.slice(0, count);
  if (count >= items.length) return { shown, more: null };
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
