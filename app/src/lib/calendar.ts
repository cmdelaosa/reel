import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";

export const feedRowSchema = z.object({
  episode_id: z.string().uuid(),
  title_id: z.string().uuid(),
  tmdb_id: z.number().int(),
  show_name: z.string(),
  poster_path: z.string().nullable(),
  network: z.string().nullable(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  episode_name: z.string().nullable(),
  air_datetime: z.string(),
  is_premiere: z.boolean(),
  is_finale: z.boolean(),
  watch_event_id: z.string().uuid().nullable(),
});
export type FeedRow = z.infer<typeof feedRowSchema>;

const WEEK_MS = 7 * 24 * 3600_000;

/** Episodes of followed shows in [now - weeksBack, now + 12 weeks]. Widening
 *  weeksBack keeps previous data on screen while the wider range loads. */
export function useCalendarFeed(weeksBack: number) {
  return useQuery({
    queryKey: [...qk.calendarFeed("weeksBack", String(weeksBack))],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FeedRow[]> => {
      const now = Date.now();
      const from = new Date(now - weeksBack * WEEK_MS).toISOString();
      const to = new Date(now + 12 * WEEK_MS).toISOString();
      const { data, error } = await supabase.rpc("rpc_calendar_feed", { p_from: from, p_to: to });
      if (error) throw error;
      return z.array(feedRowSchema).parse(data);
    },
  });
}
