import { createContext, useContext, useMemo, useState } from "react";
import { ALL_TITLES, INITIAL_FOLLOWED, Title, Status } from "./data";

/* ============================================================
   Watchlist — the app's core split: shows you follow (in your watchlist)
   vs shows you don't. Library views (Tonight / Shows / Calendar) read the
   followed set; Explore offers the rest with a Follow action.
   ============================================================ */

interface WatchlistCtx {
  isFollowed: (id: string) => boolean;
  follow: (id: string) => void;
  unfollow: (id: string) => void;
  toggle: (id: string) => void;
  count: number;
  followed: Title[];                         // shows in your watchlist
  discover: Title[];                         // shows you don't follow yet
  inStatus: (s: Status) => Title[];          // followed shows in a given status
}

const Ctx = createContext<WatchlistCtx>(null as unknown as WatchlistCtx);
export const useWatchlist = () => useContext(Ctx);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(() => new Set(INITIAL_FOLLOWED));

  const value = useMemo<WatchlistCtx>(() => {
    const isFollowed = (id: string) => ids.has(id);
    const mutate = (id: string, add: boolean) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (add) next.add(id); else next.delete(id);
        return next;
      });
    const followed = ALL_TITLES.filter((t) => ids.has(t.id));
    const discover = ALL_TITLES.filter((t) => !ids.has(t.id));
    return {
      isFollowed,
      follow: (id) => mutate(id, true),
      unfollow: (id) => mutate(id, false),
      toggle: (id) => mutate(id, !ids.has(id)),
      count: ids.size,
      followed,
      discover,
      inStatus: (s) => followed.filter((t) => t.status === s),
    };
  }, [ids]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
