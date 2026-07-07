import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { getSeason, getTitle } from "@/lib/tmdb";

/* Detail-sheet data: title+seasons (proxy, cached), episodes per season
   (lazy), and the caller's watched episode-ids for one title. */

export function useTitle(tmdbId: number | null) {
  return useQuery({
    queryKey: qk.title(tmdbId ?? 0),
    enabled: tmdbId != null,
    staleTime: 5 * 60_000,
    queryFn: () => getTitle(tmdbId!),
  });
}

export function useSeasonEpisodes(tmdbId: number | null, season: number | null) {
  return useQuery({
    queryKey: qk.season(tmdbId ?? 0, season ?? -1),
    enabled: tmdbId != null && season != null,
    staleTime: 5 * 60_000,
    queryFn: () => getSeason(tmdbId!, season!),
  });
}

const epLiteSchema = z.array(
  z.object({
    id: z.string().uuid(),
    season_number: z.number().int(),
    episode_number: z.number().int(),
    air_datetime: z.string().nullable(),
  }),
);
export type EpisodeLite = z.infer<typeof epLiteSchema>[number];

/** Every cached episode of a title (from our DB, not TMDB) — used to count
 *  unseen priors across seasons for the mark-up-to confirm. */
export function useTitleEpisodes(titleId: string | null) {
  return useQuery({
    queryKey: qk.titleEpisodes(titleId ?? ""),
    enabled: Boolean(titleId),
    queryFn: async (): Promise<EpisodeLite[]> => {
      const { data, error } = await supabase
        .from("episodes")
        .select("id, season_number, episode_number, air_datetime")
        .eq("title_id", titleId!)
        .order("season_number")
        .order("episode_number");
      if (error) throw error;
      return epLiteSchema.parse(data);
    },
  });
}

const watchedSchema = z.array(z.object({ id: z.string().uuid(), episode_id: z.string().uuid() }));

/** Map episode_id → watch_event id for the caller on one title. */
export function useWatched(titleId: string | null) {
  return useQuery({
    queryKey: qk.watched(titleId ?? ""),
    enabled: Boolean(titleId),
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("watch_events")
        .select("id, episode_id, episodes!inner(title_id)")
        .eq("episodes.title_id", titleId!);
      if (error) throw error;
      const rows = watchedSchema.parse(data.map((d) => ({ id: d.id, episode_id: d.episode_id })));
      return new Map(rows.map((r) => [r.episode_id, r.id]));
    },
  });
}
