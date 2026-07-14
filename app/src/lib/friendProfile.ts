import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

/* Rich friend-profile data for the friend page (/friend/:id): the friend's full
   follow list (with metadata + when they added it) and every show rating,
   read straight from the friend-readable tables — the 0015 friend-read RLS
   gates each one (a non-friend / private profile yields empty). Episode counts
   and "watching now" still come from rpc_friend_snapshot; this hook adds the
   browsable list, the in-common material, the taste profile and the activity
   feed, all aggregated on the client so no new RPC/migration is needed. */

const followRowSchema = z.object({
  added_at: z.string(),
  titles: z.object({
    id: z.string().uuid(),
    tmdb_id: z.number().int(),
    name: z.string(),
    poster_path: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
    network: z.string().nullable(),
    vote_average: z.number().nullable(),
    episode_run_time: z.number().int().nullable(),
    status: z.string().nullable(),
  }),
});

const ratingRowSchema = z.object({
  score: z.number().int(),
  created_at: z.string(),
  titles: z.object({
    id: z.string().uuid(),
    tmdb_id: z.number().int(),
    name: z.string(),
    poster_path: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
  }),
});

export interface FriendFollow {
  id: string;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string | null;
  genres: string[];
  network: string | null;
  vote_average: number | null;
  episode_run_time: number | null;
  status: string | null;
  added_at: string;
}

export interface FriendRating {
  id: string;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string | null;
  genres: string[];
  score: number;
  created_at: string;
}

export interface FriendProfileData {
  follows: FriendFollow[];
  ratings: FriendRating[];
}

/** Per-followed-title progress (watched/aired) for a friend, keyed by tmdb id.
 *  rpc_friend_progress is security invoker — 0015 friend-read RLS gates it, so
 *  a non-friend / private profile just yields an empty map. */
const progressRowSchema = z.object({
  tmdb_id: z.number().int(),
  watched: z.number().int(),
  aired: z.number().int(),
  last_watched_at: z.string().nullable(),
});
export type FriendProgress = z.infer<typeof progressRowSchema>;

export function useFriendProgress(friendId: string) {
  return useQuery({
    queryKey: ["friendProgress", friendId],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<Map<number, FriendProgress>> => {
      const { data, error } = await supabase.rpc("rpc_friend_progress", { p_friend: friendId });
      // PGRST202 = function not deployed yet (migration 0038); progress bars
      // are an enhancement, so degrade to "no bars" instead of erroring.
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return new Map();
        throw error;
      }
      const rows = z.array(progressRowSchema).parse(data ?? []);
      return new Map(rows.map((r) => [r.tmdb_id, r]));
    },
  });
}

export function useFriendProfile(friendId: string) {
  return useQuery({
    queryKey: ["friendProfile", friendId],
    queryFn: async (): Promise<FriendProfileData> => {
      const [followsRes, ratingsRes] = await Promise.all([
        supabase
          .from("library_entries")
          .select("added_at, titles(id, tmdb_id, name, poster_path, first_air_date, genres, network, vote_average, episode_run_time, status)")
          .eq("user_id", friendId)
          .eq("followed", true),
        supabase
          .from("ratings")
          .select("score, created_at, titles(id, tmdb_id, name, poster_path, first_air_date, genres)")
          .eq("user_id", friendId)
          .not("title_id", "is", null),
      ]);
      if (followsRes.error) throw followsRes.error;
      if (ratingsRes.error) throw ratingsRes.error;
      const follows: FriendFollow[] = z
        .array(followRowSchema)
        .parse(followsRes.data)
        .map((r) => ({ ...r.titles, added_at: r.added_at }));
      const ratings: FriendRating[] = z
        .array(ratingRowSchema)
        .parse(ratingsRes.data)
        .map((r) => ({ ...r.titles, score: r.score, created_at: r.created_at }));
      return { follows, ratings };
    },
  });
}
