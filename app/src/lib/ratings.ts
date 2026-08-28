import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { fetchPaged } from "@/lib/paging";
import { byRatedAt, type RatedAt, type SortDir } from "@/domain/ratedSort";
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

const ratedAtRowSchema = z.object({
  title_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

/** Cuándo puntuaste cada título: title_id → instante, para ordenar las tres
 *  bibliotecas por «última puntuada» (domain/ratedSort).
 *
 *  Es una lectura aparte de useMyRatings y no un `select` más de aquella: esta
 *  la piden las rejillas de biblioteca, que solo necesitan dos columnas, y
 *  aquella arrastra el título entero de cada nota —póster, géneros, fecha— para
 *  pintarlo. Con mil y pico notas importadas, la diferencia entre las dos
 *  respuestas es de dos órdenes de magnitud.
 *
 *  `updated_at` es la fecha buena, con `created_at` de reserva: puntuar de
 *  nuevo reescribe la primera y no la segunda, así que es la que responde
 *  «cuándo le puse ESTA nota». Y quien importa de FilmAffinity pone las dos a
 *  la fecha del voto a propósito (scripts/filmaffinity-import), o sea que una
 *  nota de 2015 se ordena en 2015 y no en el día de la importación.
 *
 *  Paginada, como todo lo que puede pasar de mil filas: PostgREST corta ahí sin
 *  avisar (lib/paging), y la biblioteca importada del usuario ya está por
 *  encima. Sin esto, las notas más antiguas simplemente no existirían para el
 *  orden y sus películas caerían al fondo como «sin puntuar». El `.order()`
 *  va por title_id porque hace falta un orden TOTAL —`unique (user_id,
 *  title_id)` lo garantiza— y no por fecha, que empata a cientos. */
export function useRatedAt(): RatedAt {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { data } = useQuery({
    queryKey: qk.ratedAt,
    enabled: Boolean(userId),
    /* Cinco minutos en vez de los 30 s de la casa: esto se monta en las TRES
       bibliotecas y casi siempre para no usarse —solo uno de los cinco órdenes
       lo mira—, así que con el valor por omisión un paseo por series, cine y
       juegos se baja mil y pico notas tres veces. Puede ser tan largo porque no
       depende del reloj: lo que cambia estas fechas es que TÚ puntúes, y todo lo
       que escribe una nota invalida ya esta clave por prefijo (queryKeys). */
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Acotado al usuario: la política RLS de amigos también deja ver SUS
      // notas, y sin el filtro ordenaríamos tu biblioteca por cuándo las
      // puntuó otro.
      const rows = await fetchPaged((from, to) =>
        supabase
          .from("ratings")
          .select("title_id, created_at, updated_at")
          .eq("user_id", userId!)
          .not("title_id", "is", null)
          .order("title_id")
          .range(from, to));
      return z.array(ratedAtRowSchema).parse(rows);
    },
  });
  return useMemo(
    () => new Map((data ?? []).map((r) => [r.title_id, new Date(r.updated_at ?? r.created_at).getTime()])),
    [data],
  );
}

/** El orden «última puntuada» de una rejilla de biblioteca: el comparador ya
 *  montado, el sentido y el gesto que lo voltea.
 *
 *  Vive aquí y no en cada página porque las tres bibliotecas —series, cine y
 *  juegos— son gemelas a propósito, y este orden tiene una regla de interacción
 *  propia: volver a pulsar la opción ya activa cambia el sentido en vez de no
 *  hacer nada. Tres copias de esa regla es como se acaba con tres gestos
 *  ligeramente distintos. `arrow` es lo que la etiqueta enseña para que el
 *  sentido se vea sin pulsar. */
export function useRatedSort() {
  const ratedAt = useRatedAt();
  const [dir, setDir] = useState<SortDir>("desc");
  const cmp = useMemo(() => byRatedAt(ratedAt, dir), [ratedAt, dir]);
  return {
    dir,
    cmp,
    arrow: dir === "desc" ? "↓" : "↑",
    flip: () => setDir((d) => (d === "desc" ? "asc" : "desc")),
  };
}

const ratedRowSchema = z.object({
  id: z.string().uuid(),
  score: z.number().int(),
  created_at: z.string(),
  titles: z.object({
    id: z.string().uuid(),
    tmdb_id: z.number().int(),
    /* El medio de lo puntuado. Tus notas son de los TRES —los juegos también se
       puntúan desde 0071, y la importación de InfiniteBacklog escribe cientos
       de golpe—, y cruzarlas por el número a secas confunde la película 1399
       con la serie 1399 (0067).

       Los tres nombres, y no solo los dos con los que nació esto: un `kind`
       fuera de la lista no lo ignora zod, lo hace estallar, y con él caía la
       consulta ENTERA de tus notas — es decir la afinidad, las estadísticas del
       grupo y la lista de puntuadas de tu perfil, todas a la vez. */
    kind: z.enum(["tv", "movie", "game"]),
    name: z.string(),
    poster_path: z.string().nullable(),
    first_air_date: z.string().nullable(),
    genres: z.array(z.string()),
  }),
});
export type RatedRow = z.infer<typeof ratedRowSchema>;

/** Todas tus notas con su título, la más nueva primero.
 *
 *  Paginada, y esa es la única diferencia con la versión que estuvo aquí un
 *  año: PostgREST corta en mil filas sin avisar (lib/paging) y esta cuenta ya
 *  tiene 1.460 notas —1.005 de cine tras importar FilmAffinity—, así que la
 *  lista llegaba con las 1.000 más nuevas y las otras 460 no existían para
 *  nadie. De esta consulta cuelgan las notas de tu perfil, tus cifras, la
 *  afinidad con cada amigo y la página de una persona: todas salían calculadas
 *  sobre el trozo que cupo, con la pantalla llena y sin un error que lo dijera.
 *  Es el mismo fallo que ya se tapó en la ficha de un amigo (lib/friendProfile)
 *  y en la pantalla de confirmar de Steam (lib/steam) — esta era la que
 *  quedaba, y la peor: son TUS notas.
 *
 *  El orden lleva DOS columnas y las dos hacen falta. `created_at` es lo que
 *  esta función promete —la más nueva primero—, y `title_id` detrás es lo que
 *  lo vuelve un orden TOTAL: las notas de una importación comparten fecha de a
 *  cientos, Postgres no promete un orden estable entre consultas, y sin
 *  desempate dos ventanas consecutivas repiten filas y se saltan otras. */
export function useMyRatings() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: qk.ratings,
    enabled: Boolean(userId),
    queryFn: async (): Promise<RatedRow[]> => {
      // Scope to the caller — without user_id the "friends read" RLS policy
      // would fold friends' ratings into our own list.
      const rows = await fetchPaged((from, to) =>
        supabase
          .from("ratings")
          .select("id, score, created_at, titles(id, tmdb_id, kind, name, poster_path, first_air_date, genres)")
          .eq("user_id", userId!)
          .not("title_id", "is", null)
          .order("created_at", { ascending: false })
          .order("title_id")
          .range(from, to));
      return z.array(ratedRowSchema).parse(rows);
    },
  });
}
