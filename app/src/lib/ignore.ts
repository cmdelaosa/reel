import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";

/* Ignored titles — suggestions dismissed in Explore. Stored per title_id; the
   client filters every suggestion surface by the ignored tmdb_id set, and the
   list (with names/posters) powers the Settings management view. Reversible. */

const ignoredRowSchema = z.object({
  title_id: z.string().uuid(),
  titles: z.object({
    tmdb_id: z.number().int(),
    name: z.string(),
    poster_path: z.string().nullable(),
  }),
});

export interface IgnoredTitle {
  titleId: string;
  tmdbId: number;
  name: string;
  posterPath: string | null;
}

export function useIgnored() {
  const query = useQuery({
    queryKey: qk.ignored,
    queryFn: async (): Promise<IgnoredTitle[]> => {
      const { data, error } = await supabase
        .from("ignored_titles")
        .select("title_id, titles(tmdb_id, name, poster_path)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return z
        .array(ignoredRowSchema)
        .parse(data)
        .map((r) => ({ titleId: r.title_id, tmdbId: r.titles.tmdb_id, name: r.titles.name, posterPath: r.titles.poster_path }));
    },
    staleTime: 5 * 60_000,
  });
  const tmdbIds = new Set((query.data ?? []).map((r) => r.tmdbId));
  return { ...query, ignored: query.data ?? [], isIgnored: (tmdbId: number) => tmdbIds.has(tmdbId) };
}

export function useIgnore() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (titleId: string) => {
      const { error } = await supabase
        .from("ignored_titles")
        .upsert({ user_id: session!.user.id, title_id: titleId }, { onConflict: "user_id,title_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.ignored }),
  });
}

export function useUnignore() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (titleId: string) => {
      const { error } = await supabase
        .from("ignored_titles")
        .delete()
        .eq("user_id", session!.user.id)
        .eq("title_id", titleId);
      if (error) throw error;
    },
    onMutate: async (titleId) => {
      await qc.cancelQueries({ queryKey: qk.ignored });
      const prev = qc.getQueryData<IgnoredTitle[]>(qk.ignored);
      qc.setQueryData<IgnoredTitle[]>(qk.ignored, (old = []) => old.filter((r) => r.titleId !== titleId));
      return { prev };
    },
    onError: (_e, _t, ctx) => qc.setQueryData(qk.ignored, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.ignored }),
  });
}
