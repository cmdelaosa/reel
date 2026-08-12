/** Reading a whole table's worth of rows out of PostgREST, which by default
 *  hands back the first 1000 and says nothing about the rest.
 *
 *  This is not a hypothetical limit. One Piece holds 1181 episode rows, so the
 *  air-time enrichment — which read them unpaged — was blind to the last 181:
 *  exactly the upcoming ones the calendar renders. Every episode after
 *  2021-11-21 sat on the 21:00 placeholder while TVmaze published a real time
 *  for each of them, and no error was ever raised, because a truncated page is
 *  a perfectly successful response. The count of rows up to the last one that
 *  did get a clock was exactly 1000.
 *
 *  The title selection in index.ts already pages for this reason; this is the
 *  same loop, extracted so the readers of `episodes` can share it and so it can
 *  be tested. tmdb-proxy hand-mirrors it (its own copy of the enrichment does
 *  the same reads) — keep the two in step.
 */

export const PAGE_SIZE = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Every row `page` yields, walked a window at a time until one comes back
 *  short.
 *
 *  `page` MUST impose a total order (PostgREST's `.order()`), or rows can be
 *  skipped and duplicated across window boundaries — an unordered read is only
 *  stable while it fits in one page, which is precisely the case this exists to
 *  handle. Errors are raised, not swallowed: a caller that treats a failed read
 *  as "no rows" would take a momentary outage for a deletion, and the callers
 *  here use these rows to decide what to overwrite.
 */
export async function pageAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  size: number = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0;; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (data?.length) all.push(...data);
    // A short page is the end of the table. A full one may or may not be, so it
    // costs one more request to find out — including the empty page a total
    // that lands exactly on a multiple of `size` ends with.
    if (!data || data.length < size) return all;
  }
}
