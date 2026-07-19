import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { t } from "@/lib/i18n";

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

const heatmapSchema = z.array(z.object({ day: z.string(), n: z.number().int() }));
export type HeatmapDay = z.infer<typeof heatmapSchema>[number];

/** Per-day watch counts for the profile heatmap, bucketed in the local tz.
 *  Omit `userId` for your own history; pass a friend's id for theirs — the RPC
 *  is security invoker, so the 0015 friend-read policy on watch_events decides
 *  what comes back (a non-friend or private profile yields nothing). */
export function useWatchHeatmap(days: number, userId?: string) {
  return useQuery({
    // `days` belongs in the key: it decides how much history the RPC returns,
    // so an entry cached under a narrower window would otherwise be served to a
    // wider grid — the 26→53 week change left friend grids drawing a rolling
    // year over half a year of data, blank until mid-January.
    queryKey: [...qk.watchHeatmap, userId ?? "me", days],
    queryFn: async (): Promise<HeatmapDay[] | null> => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      // Only send p_user when targeting someone else, so the own-profile call
      // still matches the pre-0048 two-arg signature on a database that hasn't
      // had the migration applied yet.
      const args = userId ? { days, tz, p_user: userId } : { days, tz };
      const { data, error } = await supabase.rpc("rpc_watch_heatmap", args);
      // PGRST202 = this signature isn't deployed yet. The grid is an extra, so
      // null (→ the component renders nothing) beats throwing, which would also
      // fire the global query-error toast on every friend page.
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return null;
        throw error;
      }
      return heatmapSchema.parse(data ?? []);
    },
  });
}

/** "77 days" style label for a minute total. */
export function timeSpentLabel(minutes: number): string {
  const days = minutes / 60 / 24;
  if (days >= 1) return `${Math.round(days)} ${t("days")}`;
  const hours = minutes / 60;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${minutes}m`;
}
