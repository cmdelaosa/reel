import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import type { TitleRow } from "@/lib/schemas";

const collectionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  sub: z.string(),
  hue: z.number().int(),
  position: z.number().int(),
});
export type Collection = z.infer<typeof collectionSchema>;

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Collection[]> => {
      const { data, error } = await supabase.from("collections").select("*").order("position");
      if (error) throw error;
      return z.array(collectionSchema).parse(data);
    },
  });
}

const titleRowSchema = z.object({
  id: z.string().uuid(),
  tmdb_id: z.number().int(),
  kind: z.enum(["tv", "movie"]),
  name: z.string(),
  overview: z.string().nullable(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable(),
  first_air_date: z.string().nullable(),
  status: z.string().nullable(),
  genres: z.array(z.string()),
  network: z.string().nullable(),
  episode_run_time: z.number().int().nullable(),
  vote_average: z.number().nullable(),
  popularity: z.number().nullable(),
});

export function useCollection(slug: string | undefined) {
  return useQuery({
    queryKey: ["collection", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<{ collection: Collection; titles: TitleRow[] }> => {
      const { data: col, error: ce } = await supabase.from("collections").select("*").eq("slug", slug!).single();
      if (ce) throw ce;
      const collection = collectionSchema.parse(col);
      const { data: cts, error: te } = await supabase
        .from("collection_titles")
        .select("position, titles(*)")
        .eq("collection_id", collection.id)
        .order("position");
      if (te) throw te;
      const titles = (cts ?? []).map((r) => titleRowSchema.parse((r as { titles: unknown }).titles));
      return { collection, titles };
    },
  });
}
