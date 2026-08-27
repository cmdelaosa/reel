import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/paging";
import type { PlayState } from "@/domain/gameStatus";
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
  /* "Lo tengo" (0076). Es lo que decide si su muro dice que algo fue a sus
     PENDIENTES o a su BIBLIOTECA, y no lo decide el medio (domain/mediumCopy).
     Opcional porque la columna llegó con una migración que se aplica a mano. */
  owned: z.boolean().nullable().optional(),
  /* Lo que ha dicho a mano de un juego suyo (0073) y cuándo lo tocó por última
     vez (0075). Es de dónde sale «Jugando ahora» en su ficha: en juegos no hay
     nada que contar —el progreso de una partida no está en ninguna tabla— así
     que o lo dice él o no se sabe. Opcionales, como `owned`: una base anterior a
     esas migraciones no trae las columnas. */
  play_state: z.enum(["backlog", "playing", "ongoing", "dropped"]).nullable().optional(),
  minutes_played: z.number().int().nullable().optional(),
  played_at: z.string().nullable().optional(),
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
    /* Las plataformas de un juego (0071). Es con lo que se describe su
       biblioteca de juegos en el perfil de gustos, igual que la cadena describe
       la de series. Vacío en los otros dos medios, y opcional para una base
       anterior a esa migración. */
    platforms: z.array(z.string()).nullable().optional(),
    /* Cuánto se tarda en terminarlo, según IGDB (0071). Es el denominador de la
       barra de horas de «Jugando ahora»; sin él se enseñan las horas a secas,
       que es lo que hace domain/gameStatus con un null aquí. */
    beat_seconds: z.object({ normally: z.number().nullable().optional() }).nullable().optional(),
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
    /** El medio de lo puntuado. La ficha calcula TRES afinidades, una por
     *  medio, porque un `tmdb_id` solo es único dentro del suyo — cruzar las
     *  tres listas en un saco inventa coincidencias (domain/tasteScope). */
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
  platforms?: string[] | null;
  beat_seconds?: { normally?: number | null } | null;
  vote_average: number | null;
  episode_run_time: number | null;
  status: string | null;
  added_at: string;
  owned: boolean | null;
  /** Solo juegos, y solo si lo dijo a mano (0073, 0075). */
  play_state?: PlayState | null;
  minutes_played?: number | null;
  played_at?: string | null;
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

/** Lo último que ha visto un amigo, de los TRES medios.
 *
 *  Filtraba por el medio del modo, y esa era la mitad de "su perfil solo enseña
 *  series": entrabas en su ficha desde Videojuegos y el muro se quedaba con lo
 *  que hubiera jugado, sin una sola de sus series. El perfil ya no mira el modo
 *  —enseña a la persona entera— así que el recorte se cae y el `limit` reparte
 *  entre los tres, que es lo que se quiere: lo último es lo último. */
export function useFriendWatchHistory(friendId: string, limit = 60) {
  return useQuery({
    queryKey: ["friendWatchHistory", friendId, limit],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<FriendWatch[]> => {
      const { data, error } = await supabase
        .from("watch_events")
        .select("watched_at, episodes!inner(season_number, episode_number, titles!inner(tmdb_id, kind, name, poster_path))")
        .eq("user_id", friendId)
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

/** Lo último que ha visto de UN medio.
 *
 *  Existe aparte de `useFriendWatchHistory` porque aquel reparte su `limit`
 *  entre los tres medios y esta pregunta no admite reparto: "lo último que vio
 *  de cine" tiene que salir aunque lleve dos meses de maratón de series. Con las
 *  sesenta filas del muro, un amigo que se haya metido cuatro temporadas no
 *  tiene ni una película dentro, y su bloque de cine desaparecía de la ficha
 *  diciendo, sin decirlo, que no ve películas.
 *
 *  El filtro va sobre el `kind` del título —dos niveles dentro del embebido— y
 *  se apoya en los `!inner` de siempre: sin ellos PostgREST devuelve la fila con
 *  el embebido a null en vez de descartarla. */
export function useFriendLastWatched(friendId: string, kind: Medium, limit = 6) {
  return useQuery({
    queryKey: ["friendLastWatched", friendId, kind, limit],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<FriendWatch[]> => {
      const { data, error } = await supabase
        .from("watch_events")
        .select("watched_at, episodes!inner(season_number, episode_number, titles!inner(tmdb_id, kind, name, poster_path))")
        .eq("user_id", friendId)
        .eq("episodes.titles.kind", kind)
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
      /* Paginadas las dos, y no por prudencia: PostgREST corta en mil filas sin
         avisar (lib/paging), y estas dos listas son justo las que crecen de
         golpe — una importación de FilmAffinity son 1.325 películas y la de
         InfiniteBacklog, 386 juegos. Leídas a medias, el perfil de gustos de un
         amigo y vuestra afinidad salían calculados sobre el trozo que cupo, con
         la pantalla llena y sin un solo error que lo dijera.

         El `.order()` de cada una es obligatorio, no decorativo: sin un orden
         total, dos ventanas consecutivas repiten filas y se saltan otras. */
      const [followsData, ratingsData] = await Promise.all([
        fetchPaged((from, to) =>
          supabase
            .from("library_entries")
            .select("added_at, owned, play_state, minutes_played, played_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres, network, platforms, beat_seconds, vote_average, episode_run_time, status)")
            .eq("user_id", friendId)
            .eq("followed", true)
            .order("title_id")
            .range(from, to)),
        fetchPaged((from, to) =>
          supabase
            .from("ratings")
            .select("score, created_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres)")
            .eq("user_id", friendId)
            .not("title_id", "is", null)
            .order("title_id")
            .range(from, to)),
      ]);
      const follows: FriendFollow[] = z
        .array(followRowSchema)
        .parse(followsData)
        .map((r) => ({
          ...r.titles,
          added_at: r.added_at,
          owned: r.owned ?? null,
          play_state: r.play_state ?? null,
          minutes_played: r.minutes_played ?? null,
          played_at: r.played_at ?? null,
        }));
      const ratings: FriendRating[] = z
        .array(ratingRowSchema)
        .parse(ratingsData)
        .map((r) => ({ ...r.titles, score: r.score, created_at: r.created_at }));
      return { follows, ratings };
    },
  });
}
