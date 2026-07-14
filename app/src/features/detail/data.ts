import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { getSeason, getTitle } from "@/lib/tmdb";
import type { TitleResponse } from "@/lib/schemas";
import { useAuth } from "@/features/auth/AuthProvider";

/* Detail-sheet data: title+seasons (proxy, cached), episodes per season
   (lazy), and the caller's watched episode-ids for one title. */

export const METADATA_STALE_MS = 24 * 60 * 60_000;
export const METADATA_GC_MS = 30 * 24 * 60 * 60_000;

export function titleQueryOptions(tmdbId: number) {
  return {
    queryKey: qk.title(tmdbId ?? 0),
    staleTime: METADATA_STALE_MS,
    gcTime: METADATA_GC_MS,
    queryFn: () => getTitle(tmdbId),
  };
}

export function useTitle(tmdbId: number | null) {
  return useQuery({
    ...titleQueryOptions(tmdbId ?? 0),
    enabled: tmdbId != null,
  });
}

export function seasonQueryOptions(tmdbId: number, season: number, titleResponse?: TitleResponse) {
  return {
    queryKey: qk.season(tmdbId ?? 0, season ?? -1),
    staleTime: METADATA_STALE_MS,
    gcTime: METADATA_GC_MS,
    // Preserve the rendered rows while another season is in flight. The detail
    // sheet dims and disables this placeholder, avoiding a collapse/flash.
    placeholderData: keepPreviousData,
    queryFn: () => getSeason(
      tmdbId,
      season,
      titleResponse?.title.id,
      titleResponse?.title.last_refreshed_at,
    ),
  };
}

export function useSeasonEpisodes(tmdbId: number | null, season: number | null, titleResponse?: TitleResponse) {
  return useQuery({
    ...seasonQueryOptions(tmdbId ?? 0, season ?? -1, titleResponse),
    enabled: tmdbId != null && season != null,
  });
}

const detailProgressSchema = z.object({
  recommended_season: z.number().int().nullable(),
  unseen_before: z.record(z.string(), z.number().int().nonnegative()),
});
export type DetailProgress = z.infer<typeof detailProgressSchema>;

/** Small server-side derivation replacing the old download of every episode
 * row just to choose an initial season and count unseen previous seasons. */
export function detailProgressQueryOptions(titleId: string) {
  return {
    queryKey: qk.detailProgress(titleId),
    queryFn: async (): Promise<DetailProgress> => {
      const { data, error } = await supabase.rpc("rpc_title_detail_progress", { p_title_id: titleId });
      if (error) throw error;
      return detailProgressSchema.parse(data);
    },
  };
}

export function useDetailProgress(titleId: string | null) {
  return useQuery({
    ...detailProgressQueryOptions(titleId ?? ""),
    enabled: Boolean(titleId),
  });
}

const watchedSchema = z.array(z.object({ id: z.string().uuid(), episode_id: z.string().uuid() }));

/** Map episode_id → watch_event id for the caller on one title. */
export function useWatched(titleId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: qk.watched(titleId ?? ""),
    enabled: Boolean(titleId) && Boolean(userId),
    queryFn: async (): Promise<Map<string, string>> => {
      // Page past the 1000-row cap so a heavily-watched long show doesn't show
      // its later episodes as unwatched (truncated map → wrong ticks).
      const PAGE = 1000;
      const raw: { id: string; episode_id: string }[] = [];
      for (let from = 0; ; from += PAGE) {
        // Scope to the caller's own rows explicitly. RLS also exposes accepted
        // friends' watch_events (the "friends read" policy ORs with the owner
        // policy), so without this filter opening a title a friend has watched
        // would render every episode ticked as if we'd watched it.
        const { data, error } = await supabase
          .from("watch_events")
          .select("id, episode_id, episodes!inner(title_id)")
          .eq("user_id", userId!)
          .eq("episodes.title_id", titleId!)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        raw.push(...(data ?? []).map((d) => ({ id: d.id, episode_id: d.episode_id })));
        if (!data || data.length < PAGE) break;
      }
      const rows = watchedSchema.parse(raw);
      return new Map(rows.map((r) => [r.episode_id, r.id]));
    },
  });
}
