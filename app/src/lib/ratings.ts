import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";

/* Show-level ratings (episode ratings stay schema-only until post-Phase 5). */

export function useMyRating(titleId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: qk.myRating(titleId ?? ""),
    enabled: Boolean(titleId) && Boolean(userId),
    queryFn: async (): Promise<number | null> => {
      // Scope to the caller: RLS also exposes friends' ratings (the "friends
      // read" policy), so without user_id this could return a friend's score as
      // ours — and maybeSingle() would throw if we and a friend both rated it.
      const { data, error } = await supabase
        .from("ratings")
        .select("score")
        .eq("user_id", userId!)
        .eq("title_id", titleId!)
        .maybeSingle();
      if (error) throw error;
      return data?.score ?? null;
    },
  });
}

export function useRateTitle(titleId: string) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (score: number) => {
      const { error } = await supabase.from("ratings").upsert(
        { user_id: session!.user.id, title_id: titleId, score, updated_at: new Date().toISOString() },
        { onConflict: "user_id,title_id" },
      );
      if (error) throw error;
    },
    onMutate: async (score) => {
      await qc.cancelQueries({ queryKey: qk.myRating(titleId) });
      const prev = qc.getQueryData<number | null>(qk.myRating(titleId));
      qc.setQueryData(qk.myRating(titleId), score);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.myRating(titleId), ctx?.prev ?? null),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.myRating(titleId) });
      qc.invalidateQueries({ queryKey: qk.ratings });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

const ratedRowSchema = z.object({
  id: z.string().uuid(),
  score: z.number().int(),
  created_at: z.string(),
  titles: z.object({
    id: z.string().uuid(),
    tmdb_id: z.number().int(),
    /* El medio de lo puntuado. Tus notas son de los dos, y cruzarlas por el
       número a secas confunde la película 1399 con la serie 1399 (0067). */
    kind: z.enum(["tv", "movie"]),
    name: z.string(),
    poster_path: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
  }),
});
export type RatedRow = z.infer<typeof ratedRowSchema>;

/** Every show-level rating of the caller, with its title, newest first. */
export function useMyRatings() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: qk.ratings,
    enabled: Boolean(userId),
    queryFn: async (): Promise<RatedRow[]> => {
      // Scope to the caller — without user_id the "friends read" RLS policy
      // would fold friends' ratings into our own list.
      const { data, error } = await supabase
        .from("ratings")
        .select("id, score, created_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres)")
        .eq("user_id", userId!)
        .not("title_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return z.array(ratedRowSchema).parse(data);
    },
  });
}
