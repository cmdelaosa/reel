import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import type { Medium } from "@/domain/tasteScope";

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
    /* El medio de la fila. La biblioteca de un amigo es de los tres desde 0071,
       y el `tmdb_id` solo es único dentro del suyo (0067): sin esto, su película
       1399 contaba como "en común" con tu serie 1399. */
    kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
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
    /** El medio de lo puntuado — la afinidad de esta ficha se calcula con el
     *  del modo, igual que la de /friends/taste (domain/tasteScope). */
    kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
    name: z.string(),
    poster_path: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
  }),
});

export interface FriendFollow {
  id: string;
  tmdb_id: number;
  kind: Medium;
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
  kind: Medium;
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

/** The friend's most recent watch events (episode + show), for the activity
 *  feed. Friend-read RLS on watch_events gates it like everything else. */
const watchRowSchema = z.object({
  watched_at: z.string(),
  episodes: z.object({
    season_number: z.number().int(),
    episode_number: z.number().int(),
    titles: z.object({
      tmdb_id: z.number().int(),
      /* El medio de lo visto. Cine y juegos arrastran un episodio sintético
         S1E1 (0067, 0071) que llega aquí como cualquier otro, así que sin esto
         el muro de la ficha no puede ni separarlos ni abrir su ficha. */
      kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
      name: z.string(),
      poster_path: z.string().nullable(),
    }),
  }),
});

export interface FriendWatch {
  watched_at: string;
  kind: Medium;
  season_number: number;
  episode_number: number;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
}

/** El muro de la ficha de un amigo, ya recortado al medio que se está mirando.
 *
 *  El recorte va en SQL y no después: `limit` corta las 60 más recientes de
 *  todas, y filtrar por medio al recibirlas dejaba el muro de cine vacío en
 *  cuanto un amigo llevaba sesenta episodios seguidos de series. */
export function useFriendWatchHistory(friendId: string, medium: Medium, limit = 60) {
  return useQuery({
    queryKey: ["friendWatchHistory", friendId, medium, limit],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<FriendWatch[]> => {
      const { data, error } = await supabase
        .from("watch_events")
        .select("watched_at, episodes!inner(season_number, episode_number, titles!inner(tmdb_id, kind, name, poster_path))")
        .eq("user_id", friendId)
        .eq("episodes.titles.kind", medium)
        .order("watched_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return z.array(watchRowSchema).parse(data).map((r) => ({
        watched_at: r.watched_at,
        season_number: r.episodes.season_number,
        episode_number: r.episodes.episode_number,
        ...r.episodes.titles,
      }));
    },
  });
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
          .select("added_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres, network, vote_average, episode_run_time, status)")
          .eq("user_id", friendId)
          .eq("followed", true),
        supabase
          .from("ratings")
          .select("score, created_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres)")
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
