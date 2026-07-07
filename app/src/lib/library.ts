import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { getTitle, tmdbImg } from "@/lib/tmdb";
import { libraryRowSchema, type LibraryRow, type TitleRow } from "@/lib/schemas";
import { deriveStatus, watchProgress, type ShowStatus } from "@/domain/status";
import { useAuth } from "@/features/auth/AuthProvider";
import type { TitleCard } from "@/domain/types";

/* The watchlist model (prototype watchlist.tsx, live): followed rows come from
   rpc_library_rollup; status is derived client-side (pure, unit-tested).
   Follow/unfollow are optimistic against the library query. */

export interface LibraryShow extends LibraryRow {
  status: ShowStatus;
  progress: number;
}

const rollupSchema = z.array(libraryRowSchema);

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

export function useLibrary() {
  return useQuery({
    queryKey: qk.library,
    queryFn: async (): Promise<LibraryShow[]> => {
      const { data, error } = await supabase.rpc("rpc_library_rollup");
      if (error) throw error;
      return rollupSchema.parse(data).map(decorate);
    },
  });
}

/** Poster-grid view-model for a library show. */
export function toTitleCard(s: LibraryShow): TitleCard {
  return {
    id: String(s.tmdb_id),
    name: s.name,
    year: s.first_air_date?.slice(0, 4) ?? "TBA",
    genres: s.genres.length ? s.genres : ["—"],
    network: s.network ?? "",
    posterPath: tmdbImg(s.poster_path),
    voteAverage: s.vote_average ?? 0,
    progress: s.status === "watching" ? s.progress : undefined,
  };
}

/** Optimistic placeholder rollup row for a title being followed from search. */
function optimisticRow(t: TitleRow): LibraryShow {
  return decorate({
    title_id: t.id,
    tmdb_id: t.tmdb_id,
    name: t.name,
    poster_path: t.poster_path,
    first_air_date: t.first_air_date,
    tmdb_status: t.status,
    genres: t.genres,
    network: t.network,
    vote_average: t.vote_average,
    favorite: false,
    notify: false,
    added_at: new Date().toISOString(),
    aired_count: t.first_air_date && t.first_air_date <= new Date().toISOString().slice(0, 10) ? 1 : 0,
    watched_count: 0,
    last_watched_at: null,
    next_air_datetime: null,
  });
}

export function useFollow() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (title: TitleRow) => {
      const { error } = await supabase.from("library_entries").upsert(
        { user_id: session!.user.id, title_id: title.id, followed: true },
        { onConflict: "user_id,title_id" },
      );
      if (error) throw error;
      // fire-and-forget: pull full seasons/episodes into the cache, then
      // refresh the rollup so aired counts become real.
      getTitle(title.tmdb_id)
        .then(() => queryClient.invalidateQueries({ queryKey: qk.library }))
        .catch(() => {});
    },
    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: qk.library });
      const prev = queryClient.getQueryData<LibraryShow[]>(qk.library);
      queryClient.setQueryData<LibraryShow[]>(qk.library, (old = []) =>
        old.some((r) => r.title_id === title.id) ? old : [...old, optimisticRow(title)],
      );
      return { prev };
    },
    onError: (_e, _t, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.library }),
  });
}

/** Toggle the per-title "Notify me" flag — optimistic against the library. */
export function useToggleNotify() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ titleId, notify }: { titleId: string; notify: boolean }) => {
      const { error } = await supabase
        .from("library_entries")
        .update({ notify })
        .eq("user_id", session!.user.id)
        .eq("title_id", titleId);
      if (error) throw error;
    },
    onMutate: async ({ titleId, notify }) => {
      await queryClient.cancelQueries({ queryKey: qk.library });
      const prev = queryClient.getQueryData<LibraryShow[]>(qk.library);
      queryClient.setQueryData<LibraryShow[]>(qk.library, (old = []) =>
        old.map((r) => (r.title_id === titleId ? { ...r, notify } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.library }),
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
      const prev = queryClient.getQueryData<LibraryShow[]>(qk.library);
      queryClient.setQueryData<LibraryShow[]>(qk.library, (old = []) =>
        old.filter((r) => r.title_id !== titleId),
      );
      return { prev };
    },
    onError: (_e, _t, ctx) => queryClient.setQueryData(qk.library, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.library }),
  });
}
