import { useMemo } from "react";
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

/** El `in.()` de PostgREST viaja en la URL, así que se trocea — el mismo motivo
 *  y el mismo tamaño que lib/providers. Sin esto, doscientos títulos son ocho
 *  kilobytes de línea de petición y un 414 que deja sin check el feed entero. */
const CHUNK = 200;

export function useMovieEpisodeIds() {
  const { data: movies = [] } = useMovieLibrary();
  const titleIds = useMemo(() => movies.map((m) => m.title_id).sort(), [movies]);

  return useQuery({
    /* Clave sin la lista: se compara en cada render de cada fila que llame a
       este hook, y hashear doscientos uuid por fila y por pintado es trabajo
       puro. Lo que la mantiene al día no es la clave sino la invalidación —
       seguir o dejar de seguir una película tira esta consulta desde
       invalidateLibraryDerived, que es el único momento en que el mapa puede
       quedarse corto. */
    queryKey: ["movieEpisodeIds"],
    enabled: titleIds.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const chunks: string[][] = [];
      for (let i = 0; i < titleIds.length; i += CHUNK) chunks.push(titleIds.slice(i, i + CHUNK));
      const responses = await Promise.all(
        chunks.map((ids) => supabase.from("episodes").select("id, title_id").in("title_id", ids)),
      );
      const out = new Map<string, string>();
      for (const { data, error } of responses) {
        if (error) throw error;
        for (const r of z.array(rowSchema).parse(data ?? [])) out.set(r.title_id, r.id);
      }
      return out;
    },
  });
}
