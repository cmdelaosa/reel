import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Medium } from "@/domain/tasteScope";

/* Ignored titles — suggestions dismissed in Explore. Stored per title_id; the
   client filters every suggestion surface by the ignored set, and the list
   (with names/posters) powers the hidden-titles panel of each Explore screen.
   Reversible.

   El conjunto va por "medio:id" y no por el id a secas: `titles.tmdb_id` solo
   es único dentro de su medio (0067, 0071), así que ocultar una serie escondía
   además la película y el juego que llevaran ese número — y como no aparecían
   en ninguna sugerencia, no había dónde darles al ojo para recuperarlas. */

const ignoredRowSchema = z.object({
  title_id: z.string().uuid(),
  titles: z.object({
    tmdb_id: z.number().int(),
    /* Opcional con respaldo a 'tv' por lo mismo que en la biblioteca: una base
       anterior a 0067 devuelve la fila sin esta columna, y lo que había
       entonces eran series. */
    kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
    name: z.string(),
    poster_path: z.string().nullable(),
  }),
});

export interface IgnoredTitle {
  titleId: string;
  tmdbId: number;
  kind: Medium;
  name: string;
  posterPath: string | null;
}

const ignoreKey = (tmdbId: number, kind: Medium) => `${kind}:${tmdbId}`;

export function useIgnored() {
  const query = useQuery({
    queryKey: qk.ignored,
    queryFn: async (): Promise<IgnoredTitle[]> => {
      const { data, error } = await supabase
        .from("ignored_titles")
        .select("title_id, titles(tmdb_id, kind, name, poster_path)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return z
        .array(ignoredRowSchema)
        .parse(data)
        .map((r) => ({
          titleId: r.title_id,
          tmdbId: r.titles.tmdb_id,
          kind: r.titles.kind,
          name: r.titles.name,
          posterPath: r.titles.poster_path,
        }));
    },
    staleTime: 5 * 60_000,
  });
  /* `kind` es OBLIGATORIO en isIgnored, sin valor por defecto: un respaldo a
     "tv" haría que cada llamador nuevo heredase en silencio justo el cruce que
     esto viene a quitar. Que el compilador lo pregunte. */
  const keys = new Set((query.data ?? []).map((r) => ignoreKey(r.tmdbId, r.kind)));
  return {
    ...query,
    ignored: query.data ?? [],
    isIgnored: (tmdbId: number, kind: Medium) => keys.has(ignoreKey(tmdbId, kind)),
  };
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
