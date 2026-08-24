import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useMovieLibrary } from "@/lib/library";

/* El puente entre una película y la fila de watch_events que la marca vista.
 *
 * Marcar algo visto escribe un episodio (0067), y las listas de cine no traen
 * ese id: rpc_movie_releases devuelve estrenos y rpc_library_rollup devuelve
 * títulos. La ficha lo recibe del proxy en su propia respuesta, pero una lista
 * de treinta estrenos no puede pedir treinta fichas.
 *
 * Así que se resuelven todos de una vez, en una sola consulta por biblioteca:
 * cada película tiene exactamente un episodio, así que el mapa
 * title_id → episode_id es pequeño, estable y se comparte entre todas las
 * pantallas de cine. Se invalida solo cuando cambia la biblioteca, porque una
 * película nueva es la única forma de que aparezca un episodio nuevo. */

const rowSchema = z.object({ id: z.string().uuid(), title_id: z.string().uuid() });

export function useMovieEpisodeIds() {
  const { data: movies = [] } = useMovieLibrary();
  const titleIds = movies.map((m) => m.title_id).sort();

  return useQuery({
    queryKey: ["movieEpisodeIds", titleIds],
    enabled: titleIds.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("episodes")
        .select("id, title_id")
        .in("title_id", titleIds);
      if (error) throw error;
      return new Map(z.array(rowSchema).parse(data ?? []).map((r) => [r.title_id, r.id]));
    },
  });
}
