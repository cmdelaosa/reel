import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { getCollectionTitles } from "@/lib/tmdb";
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

export function useCollection(slug: string | undefined) {
  return useQuery({
    queryKey: ["collection", slug],
    enabled: Boolean(slug),
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<{ collection: Collection; titles: TitleRow[] }> => {
      const { data: col, error: ce } = await supabase.from("collections").select("*").eq("slug", slug!).single();
      if (ce) throw ce;
      const collection = collectionSchema.parse(col);
      const titles = await getCollectionTitles(slug!);
      return { collection, titles };
    },
  });
}
