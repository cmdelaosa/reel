import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { fetchPaged } from "@/lib/paging";
import { getMovie, getTitle, tmdbImg } from "@/lib/tmdb";
import { libraryRowSchema, type LibraryRow, type TitleRow } from "@/lib/schemas";
import { deriveStatus, watchProgress, type ShowStatus } from "@/domain/status";
import { deriveMovieStatus, type MovieStatus } from "@/domain/movieStatus";
import { deriveGameStatus, hoursProgress, type GameStatus } from "@/domain/gameStatus";
import { useAuth } from "@/features/auth/AuthProvider";
import type { TitleCard } from "@/domain/types";

/* The watchlist model (prototype watchlist.tsx, live): followed rows come from
   rpc_library_rollup; status is derived client-side (pure, unit-tested).
   Follow/unfollow are optimistic against the library query. */

export interface LibraryShow extends LibraryRow {
  status: ShowStatus;
  progress: number;
}

/** Una película de tu biblioteca. Sin `progress`: no hay tal cosa. */
export interface LibraryMovie extends LibraryRow {
  status: MovieStatus;
}

/** Un juego de tu biblioteca.
 *
 *  `progress` es null y no 0 cuando no se puede medir —un juego sin final, o uno
 *  sin tiempos en IGDB—, y esa diferencia la pinta la tarjeta: barra vacía
 *  frente a sin barra. Ver domain/gameStatus.ts. */
export interface LibraryGame extends LibraryRow {
  status: GameStatus;
  progress: number | null;
}

const rollupSchema = z.array(libraryRowSchema);

/* Follow/notify/unfollow all change what rpc_up_next, rpc_calendar_feed and
   rpc_user_stats return (they key off library_entries.followed), so invalidate
   those derived queries too — not just the rollup. Mirrors watch.ts. */
function invalidateLibraryDerived(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.library });
  qc.invalidateQueries({ queryKey: qk.upNext });
  qc.invalidateQueries({ queryKey: qk.stats });
  qc.invalidateQueries({ queryKey: ["calendarFeed"] });
  // Seguir una película crea su episodio sintético (0067) y dejar de seguirla
  // deja el suyo huérfano: el mapa title_id → episode_id que usan las listas de
  // cine para marcar vista se queda corto si nadie lo tira.
  qc.invalidateQueries({ queryKey: ["movieEpisodeIds"] });
}

function decorate(row: LibraryRow): LibraryShow {
  return {
    ...row,
    status: deriveStatus({
      airedCount: row.aired_count,
      watchedCount: row.watched_count,
      tmdbStatus: row.tmdb_status,
    }),
    progress: watchProgress({ airedCount: row.aired_count, watchedCount: row.watched_count }),
  };
}

/* La biblioteca es UNA, con los dos medios dentro (rpc_library_rollup no
   filtra), y se pide una sola vez. Lo que hay son dos lecturas de ella.

   useLibrary() devuelve SOLO SERIES, y no por comodidad: media docena de
   pantallas preguntan "¿sigo este tmdb_id?" comparando el número a secas, y un
   id de TMDB solo es único dentro de su medio (0067). Sin el filtro, la
   película 1399 aparecería como seguida porque lo está la serie 1399. El
   filtro vive aquí, en el único sitio por el que pasan todas.

   Se exporta la cruda para las pantallas COMPARTIDAS —las de amigos—, que no
   son de un medio sino del que tengas puesto: allí el filtro lo pone quien lee,
   con el `medium` del conmutador. Llamar a `useLibrary()` desde ellas daba por
   no seguido todo tu cine y todos tus juegos. */
/** Toda la biblioteca, ventana a ventana.
 *
 *  Sin esto, una biblioteca de más de mil títulos se lee a medias y la pantalla
 *  que la pinta no tiene forma de saberlo: PostgREST corta en mil y no avisa.
 *  El bucle y su matriz de pruebas viven en lib/paging, que es de donde lo
 *  copian las demás lecturas largas (la ficha de un amigo, la primera).
 *
 *  El `.order("title_id")` no es cosmético, y por eso lo pone quien llama: sin
 *  un orden TOTAL, dos ventanas consecutivas pueden repetir filas y saltarse
 *  otras — Postgres no promete un orden estable entre consultas—, y eso es
 *  justo lo que ese bucle provoca. */
export function useLibraryRows() {
  return useQuery({
    queryKey: qk.library,
    queryFn: async (): Promise<LibraryRow[]> => {
      const data = await fetchPaged((from, to) =>
        supabase.rpc("rpc_library_rollup").order("title_id").range(from, to));
      return rollupSchema.parse(data);
    },
  });
}

export function useLibrary() {
  const q = useLibraryRows();
  const data = useMemo(
    () => (q.data ?? []).filter((r) => r.kind === "tv").map(decorate),
    [q.data],
  );
  return { ...q, data };
}

/** Tu cine. Mismo origen, otro estado: una película no tiene progreso, así que
 *  no pasa por deriveStatus sino por deriveMovieStatus. */
export function useMovieLibrary() {
  const q = useLibraryRows();
  const data = useMemo(
    () =>
      (q.data ?? [])
        .filter((r) => r.kind === "movie")
        .map((row): LibraryMovie => ({
          ...row,
          status: deriveMovieStatus({ airedCount: row.aired_count, watchedCount: row.watched_count }),
        })),
    [q.data],
  );
  return { ...q, data };
}

/** Tus juegos. Tercera lectura de la misma biblioteca.
 *
 *  A diferencia de los otros dos medios, el estado no sale solo de la
 *  aritmética: `play_state` es lo que la persona dijo a mano y manda sobre la
 *  fecha de salida (pero no sobre "terminado", que es el watch_event). */
export function useGameLibrary() {
  const q = useLibraryRows();
  const data = useMemo(
    () =>
      (q.data ?? [])
        .filter((r) => r.kind === "game")
        .map((row): LibraryGame => {
          const status = deriveGameStatus({
            airedCount: row.aired_count,
            watchedCount: row.watched_count,
            playState: row.play_state,
            owned: row.owned,
            minutesPlayed: row.minutes_played,
          });
          return {
            ...row,
            status,
            progress: hoursProgress(row.minutes_played ?? 0, row.beat_seconds, status),
          };
        }),
    [q.data],
  );
  return { ...q, data };
}

/** Poster-grid view-model for a library show. */
export function toTitleCard(s: LibraryShow): TitleCard {
  return {
    id: String(s.tmdb_id),
    name: s.name,
    year: s.first_air_date?.slice(0, 4) ?? "TBA",
    genres: s.genres.length ? s.genres : ["—"],
    posterPath: tmdbImg(s.poster_path),
    voteAverage: s.vote_average ?? 0,
    progress: s.status === "watching" ? s.progress : undefined,
    stopped: s.stopped,
  };
}

/** Optimistic placeholder rollup row for a title being followed from search. */
function optimisticRow(t: TitleRow): LibraryRow {
  return {
    title_id: t.id,
    tmdb_id: t.tmdb_id,
    kind: t.kind,
    name: t.name,
    poster_path: t.poster_path,
    // La fila de búsqueda ya la trae cuando existe (en un juego recién buscado
    // es null: `gameSearchRow` no pide artworks). Null aquí solo significa que
    // el banner usa la carátula hasta que el refetch traiga la fila de verdad.
    backdrop_path: t.backdrop_path,
    first_air_date: t.first_air_date,
    tmdb_status: t.status,
    genres: t.genres,
    network: t.network,
    vote_average: t.vote_average,
    favorite: false,
    notify: false,
    stopped: false,
    added_at: new Date().toISOString(),
    aired_count: t.first_air_date && t.first_air_date <= new Date().toISOString().slice(0, 10) ? 1 : 0,
    watched_count: 0,
    last_watched_at: null,
    last_aired_datetime: null,
    next_air_datetime: null,
    upcoming_season_number: null,
    upcoming_season_air_date: null,
  };
}

export function useFollow() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (title: TitleRow) => {
      const { error } = await supabase.from("library_entries").upsert(
        // stopped:false so re-adding a previously stopped show reactivates it —
        // otherwise it stays stopped=true and invisible in Tonight/Shows.
        { user_id: session!.user.id, title_id: title.id, followed: true, stopped: false },
        { onConflict: "user_id,title_id" },
      );
      if (error) throw error;
      // fire-and-forget: pull full seasons/episodes into the cache, then
      // refresh the rollup so aired counts become real.
      //
      // Una película va por su propia ruta: /title/:id es /tv/:id en el proxy,
      // y pedirlo con el id de una peli trae otra cosa o un 404. Lo que rellena
      // ahí el recuento no son episodios sino el estreno — el detalle escribe
      // first_air_date y el trigger de 0067 mueve con él el episodio sintético.
      //
      // Un JUEGO no pasa por aquí, y no es una omisión: su ficha la sirve
      // igdb-proxy y su recuento es el episodio sintético que 0071 ya creó al
      // guardarlo. Pedirle `/title/:id` a tmdb-proxy con un id de IGDB no es un
      // 404 inofensivo — es pedir la SERIE que lleve ese número, y el proxy la
      // cachearía en `titles` pisando la fila del juego. Se descubrió al abrir
      // la rejilla de la biblioteca de un amigo a los tres medios, que es el
      // primer sitio desde el que se puede añadir un juego que no es tuyo.
      if (title.kind !== "game") {
        const fill = title.kind === "movie" ? getMovie(title.tmdb_id) : getTitle(title.tmdb_id);
        fill
          .then(() => queryClient.invalidateQueries({ queryKey: qk.library }))
          .catch(() => {});
      }
    },
    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: qk.library });
      const prev = queryClient.getQueryData<LibraryRow[]>(qk.library);
      queryClient.setQueryData<LibraryRow[]>(qk.library, (old = []) =>
        old.some((r) => r.title_id === title.id)
          ? old.map((r) => (r.title_id === title.id ? { ...r, followed: true, stopped: false } : r))
          : [...old, optimisticRow(title)],
      );
      return { prev };
    },
    onError: (_e, _t, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => invalidateLibraryDerived(queryClient),
  });
}

/* There is no per-title notify toggle: alerts follow the show's status
   (migration 0059), so a manual flag would only contradict it. `notify` is
   still on library_entries and still written false when a show is stopped —
   nothing reads it. */

/** Stop / resume a followed show. Stopping keeps history but drops it out of
 *  Tonight/up-next/calendar, and stops its new-episode alerts. Optimistic. */
export function useSetStopped() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ titleId, stopped }: { titleId: string; stopped: boolean }) => {
      const patch = stopped ? { stopped: true, notify: false } : { stopped: false };
      const { error } = await supabase
        .from("library_entries")
        .update(patch)
        .eq("user_id", session!.user.id)
        .eq("title_id", titleId);
      if (error) throw error;
    },
    onMutate: async ({ titleId, stopped }) => {
      await queryClient.cancelQueries({ queryKey: qk.library });
      const prev = queryClient.getQueryData<LibraryRow[]>(qk.library);
      queryClient.setQueryData<LibraryRow[]>(qk.library, (old = []) =>
        old.map((r) => (r.title_id === titleId ? { ...r, stopped, notify: stopped ? false : r.notify } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => invalidateLibraryDerived(queryClient),
  });
}

export function useUnfollow() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (titleId: string) => {
      const { error } = await supabase
        .from("library_entries")
        .update({ followed: false })
        .eq("user_id", session!.user.id)
        .eq("title_id", titleId);
      if (error) throw error;
    },
    onMutate: async (titleId) => {
      await queryClient.cancelQueries({ queryKey: qk.library });
      const prev = queryClient.getQueryData<LibraryRow[]>(qk.library);
      queryClient.setQueryData<LibraryRow[]>(qk.library, (old = []) =>
        old.filter((r) => r.title_id !== titleId),
      );
      return { prev };
    },
    onError: (_e, _t, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => invalidateLibraryDerived(queryClient),
  });
}
