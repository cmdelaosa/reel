import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { getTrending, getPopular, getPopularNow, getTopRated } from "@/lib/tmdb";
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

/** "Top rated" grid: highest-scored shows, optionally filtered to a first-air-
 *  year range and genre set. Genre filtering is server-side (unlike the
 *  Popular-now grid): a niche genre's top shows rarely survive inside a global
 *  popularity pool, so the proxy queries TMDB per genre. Keyed on all filters;
 *  keeps the prior grid on screen while a new combination loads.
 *
 *  `enabled` is the tab gate. This used to fetch on every Explore load whether
 *  or not the reader ever opened the tab — a fourth proxy request racing the
 *  three the page actually renders, over the same cold edge isolate. */
export function useTopRated(from: number | null, to: number | null, genreIds: number[], enabled: boolean) {
  return useQuery({
    queryKey: ["topRated", from, to, [...genreIds].sort((a, b) => a - b).join(",")],
    enabled,
    staleTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: (): Promise<TitleRow[]> => getTopRated(from, to, genreIds),
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
    // Present once migration 0035 lands; optional so the tab keeps parsing
    // against the older RPC shape (cards without an id skip add/hide).
    id: z.string().uuid().optional(),
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

/** Shows your circle follows, for the With-friends tab. `enabled` carries both
 *  the "has friends at all" check and the tab gate — same reason as
 *  {@link useTopRated}: an RPC nobody is looking at should not be competing for
 *  the page's first paint. */
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

const activityVerbs = ["rated", "added", "watched", "started", "finished_season"] as const;
const activitySchema = z.array(
  z.object({
    friend_id: z.string().uuid(),
    friend_name: z.string(),
    friend_avatar: z.string().nullable(),
    // Post-0040 the RPC emits rated/added/watched; the older verbs stay in the
    // enum so either side can deploy first without breaking the feed.
    verb: z.enum(activityVerbs),
    tmdb_id: z.number().int(),
    /* El medio (0069; los juegos, 0074). Opcional para que un cliente
       desplegado antes de la migración siga pintando la lista — se lee como
       serie, que es lo que había — y porque el frontend sale solo al mergear
       mientras la migración va a mano. */
    kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
    title_name: z.string(),
    poster_path: z.string().nullable(),
    score: z.number().int().nullable(),
    season_number: z.number().int().nullable(),
    episode_number: z.number().int().nullable().optional(),
    at: z.string(),
    /* 0058 fields. event_key and ep_count stay optional so a client that
       somehow reaches production before the migration still renders a feed —
       the rows lose their reactions and their episode ranges, but nothing
       throws. (title_id is returned too; the client no longer needs it, since
       0058 derives the reaction's target from the key itself.) */
    event_key: z.string().optional(),
    to_season: z.number().int().nullable().optional(),
    to_episode: z.number().int().nullable().optional(),
    ep_count: z.number().int().optional(),
    /* 0077: lo añadido viene plegado por (persona, día, lista). `added_count`
       es cuántas cosas hay en el grupo —1 en una fila normal— y `added_list`
       dónde cayeron, que desde 0076 ya no lo decide el medio (un juego con
       "Lo tengo" va a la biblioteca, no a los pendientes). Opcionales, como
       todo lo que este esquema fue ganando: un frontend desplegado antes que
       la migración pinta la fila de siempre en vez de romperse. */
    added_count: z.number().int().nullable().optional(),
    added_list: z.enum(["watchlist", "backlog", "library"]).nullable().optional(),
  }),
);
export type ActivityItem = z.infer<typeof activitySchema>[number];

/* Los títulos que hay detrás de una fila plegada. Se piden al desplegarla y no
   viajan en el muro: treinta filas con su lista entera dentro pueden ser miles
   de títulos para pintar tres frases, y lo normal es que nadie despliegue
   ninguna. */
const addedBatchSchema = z.array(
  z.object({
    tmdb_id: z.number().int(),
    kind: z.enum(["tv", "movie", "game"]),
    name: z.string(),
    poster_path: z.string().nullable(),
    added_at: z.string(),
  }),
);
export type AddedBatchItem = z.infer<typeof addedBatchSchema>[number];

/** El detalle de un grupo del muro, por su clave de evento.
 *
 *  La clave lleva dentro de quién y de qué día es, y el servidor la parte: es
 *  el mismo identificador que 0058 usa para las reacciones, así que no hace
 *  falta una segunda forma de nombrar la misma fila. Quién puede leerla lo
 *  decide la RLS de `library_entries`, no esta consulta.
 *
 *  `enabled` es lo que la hace perezosa: no se pide hasta que alguien despliega
 *  la fila, y `staleTime` en infinito porque lo añadido un día pasado ya no
 *  cambia. */
export function useAddedBatch(eventKey: string | null) {
  return useQuery({
    queryKey: qk.addedBatch(eventKey ?? ""),
    enabled: Boolean(eventKey),
    staleTime: Infinity,
    queryFn: async (): Promise<AddedBatchItem[]> => {
      const { data, error } = await supabase.rpc("rpc_added_batch", { p_event_key: eventKey });
      if (error) throw error;
      return addedBatchSchema.parse(data);
    },
  });
}

/** The circle's wall. Deliberately ungated: the RPC builds the circle from
 *  `friendships` itself, so asking the caller to prove it has friends first
 *  only bought a second round trip's worth of latency in front of the app's
 *  most expensive query. With no friends the circle is you alone and this
 *  returns your own rows cheaply — the *display* gate lives in the component. */
export function useFriendActivity(limit = 30) {
  return useQuery({
    queryKey: qk.friendActivity(limit),
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase.rpc("rpc_friend_activity", { p_limit: limit });
      if (error) throw error;
      return activitySchema.parse(data);
    },
  });
}
