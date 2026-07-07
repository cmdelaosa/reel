import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";

export const upNextRowSchema = z.object({
  title_id: z.string().uuid(),
  tmdb_id: z.number().int(),
  name: z.string(),
  poster_path: z.string().nullable(),
  network: z.string().nullable(),
  vote_average: z.number().nullable(),
  episode_id: z.string().uuid(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  episode_name: z.string().nullable(),
  air_datetime: z.string().nullable(),
  aired_count: z.number().int(),
  watched_count: z.number().int(),
  last_watched_at: z.string().nullable(),
});
export type UpNextRow = z.infer<typeof upNextRowSchema>;

/** Started shows and their next unwatched aired episode. */
export function useUpNext() {
  return useQuery({
    queryKey: qk.upNext,
    queryFn: async (): Promise<UpNextRow[]> => {
      const { data, error } = await supabase.rpc("rpc_up_next");
      if (error) throw error;
      return z.array(upNextRowSchema).parse(data);
    },
  });
}
