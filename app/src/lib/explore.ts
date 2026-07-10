import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { getTrending, getPopular, getPopularNow } from "@/lib/tmdb";
import type { TitleRow } from "@/lib/schemas";

export function useTrending() {
  return useQuery({
    queryKey: ["trending"],
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: (): Promise<TitleRow[]> => getTrending(),
  });
}

/** "Popular now" for the discover grid's default mode: recent/imminent season
 *  premieres by popularity. Disabled while the year filters are active. */
export function usePopularNow(enabled: boolean) {
  return useQuery({
    queryKey: ["popularNow"],
    enabled,
    staleTime: 60 * 60 * 1000,
    queryFn: (): Promise<TitleRow[]> => getPopularNow(),
  });
}

/** Popular shows for the discover grid's catalog mode, filtered to a first-air-
 *  year range. Keyed on the range so changing the years refetches; keeps the
 *  prior page on screen while the new range loads. */
export function usePopular(from: number | null, to: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["popular", from, to],
    enabled,
    staleTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: (): Promise<TitleRow[]> => getPopular(from, to),
  });
}

/* Friend-powered Explore data (P4-C3) + activity feed (P4-C4). */

const friendRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  avatar_url: z.string().nullable(),
});

const popularSchema = z.array(
  z.object({
    tmdb_id: z.number().int(),
    name: z.string(),
    poster_path: z.string().nullable(),
    network: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
    vote_average: z.number().nullable(),
    count: z.number().int(),
    friends: z.array(friendRefSchema),
    i_follow: z.boolean(),
  }),
);
export type PopularWithFriends = z.infer<typeof popularSchema>[number];

const bestRatedSchema = z.array(
  z.object({
    tmdb_id: z.number().int(),
    name: z.string(),
    poster_path: z.string().nullable(),
    network: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
    vote_average: z.number().nullable(),
    avg_score: z.number(),
    count: z.number().int(),
    raters: z.array(friendRefSchema.extend({ score: z.number().int() })),
    i_follow: z.boolean(),
  }),
);
export type BestRatedByFriends = z.infer<typeof bestRatedSchema>[number];

export function usePopularWithFriends(enabled: boolean) {
  return useQuery({
    queryKey: ["popularWithFriends"],
    enabled,
    queryFn: async (): Promise<PopularWithFriends[]> => {
      const { data, error } = await supabase.rpc("rpc_popular_with_friends");
      if (error) throw error;
      return popularSchema.parse(data);
    },
  });
}

export function useBestRatedByFriends(enabled: boolean) {
  return useQuery({
    queryKey: ["bestRatedByFriends"],
    enabled,
    queryFn: async (): Promise<BestRatedByFriends[]> => {
      const { data, error } = await supabase.rpc("rpc_best_rated_by_friends");
      if (error) throw error;
      return bestRatedSchema.parse(data);
    },
  });
}

const activitySchema = z.array(
  z.object({
    friend_id: z.string().uuid(),
    friend_name: z.string(),
    friend_avatar: z.string().nullable(),
    verb: z.enum(["rated", "added", "started", "finished_season"]),
    tmdb_id: z.number().int(),
    title_name: z.string(),
    poster_path: z.string().nullable(),
    score: z.number().int().nullable(),
    season_number: z.number().int().nullable(),
    at: z.string(),
  }),
);
export type ActivityItem = z.infer<typeof activitySchema>[number];

export function useFriendActivity(enabled: boolean, limit = 30) {
  return useQuery({
    queryKey: ["friendActivity", limit],
    enabled,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase.rpc("rpc_friend_activity", { p_limit: limit });
      if (error) throw error;
      return activitySchema.parse(data);
    },
  });
}
