import { useState } from "react";
import { t as tr } from "@/lib/i18n";

/* Progressive reveal for a section's list — the app's one paging idiom, the
   same "Show more" Discover grew its grid with. useShowMore slices the list to
   what has been revealed so far and hands back the ready-to-place button;
   render `more` after the grid, not in the section header. Null once
   everything is shown. */

export function useShowMore<T>(items: T[], pageSize: number): { shown: T[]; more: React.ReactNode } {
  const [count, setCount] = useState(pageSize);
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
