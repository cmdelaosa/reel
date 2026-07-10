import { useSearchParams } from "react-router";

/** Returns a callback that opens the detail sheet for a tmdb id by setting the
 *  global `?title=` param. Shared by the calendar, Tonight and explore rows. */
export function useOpenTitle() {
  const [, setSearchParams] = useSearchParams();
  return (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });
}
