import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { isEs } from "@/lib/i18n";

const statsSchema = z.object({
  episodes_watched: z.number().int(),
  minutes_watched: z.number().int(),
  shows_followed: z.number().int(),
  coming_soon: z.number().int(),
  avg_rating: z.number().nullable(),
  friends: z.number().int(),
});
export type UserStats = z.infer<typeof statsSchema>;

export function useUserStats() {
  return useQuery({
    queryKey: qk.stats,
    queryFn: async (): Promise<UserStats> => {
      const { data, error } = await supabase.rpc("rpc_user_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return statsSchema.parse(row);
    },
  });
}

/** "77 days" style label for a minute total. */
export function timeSpentLabel(minutes: number): string {
  const days = minutes / 60 / 24;
  if (days >= 1) return `${Math.round(days)} ${isEs() ? "días" : "days"}`;
  const hours = minutes / 60;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${minutes}m`;
}
