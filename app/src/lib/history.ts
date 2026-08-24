import { useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";

/* Watch history — the caller's watched episodes newest-first, paged backwards
   through time via the (watched_at, id) keyset cursor rpc_watch_history exposes.
   Mirrors calendar.ts (zod-validated RPC rows) but with useInfiniteQuery so a
   years-deep TV Time import loads a page at a time. */

export const historyRowSchema = z.object({
  watch_event_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  title_id: z.string().uuid(),
  tmdb_id: z.number().int(),
  /* El medio (0069; los juegos, 0074). Opcional por lo de siempre: el frontend
     se despliega solo al mergear y la migración va a mano, así que hay una
     ventana en la que la columna no existe todavía. Sin ella se lee como
     serie. */
  kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
  show_name: z.string(),
  poster_path: z.string().nullable(),
  network: z.string().nullable(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  episode_name: z.string().nullable(),
  watched_at: z.string(),
  source: z.string(),
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

/** Cursor into the ordered stream: the last row of the previous page. */
type Cursor = { before: string; beforeId: string } | null;

const PAGE = 60;

export function useWatchHistory() {
  return useInfiniteQuery({
    queryKey: qk.history,
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<HistoryRow[]> => {
      const { data, error } = await supabase.rpc("rpc_watch_history", {
        p_limit: PAGE,
        p_before: pageParam?.before ?? null,
        p_before_id: pageParam?.beforeId ?? null,
      });
      if (error) throw error;
      return z.array(historyRowSchema).parse(data);
    },
    getNextPageParam: (last): Cursor | undefined => {
      if (last.length < PAGE) return undefined; // fewer than a full page → the end
      const tail = last[last.length - 1];
      return { before: tail.watched_at, beforeId: tail.watch_event_id };
    },
  });
}
