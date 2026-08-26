import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings } from "@/lib/taste";
import type { FriendEntry } from "@/domain/friendTitleStatus";
import type { Medium } from "@/domain/tasteScope";

/* Tus amigos SOBRE ESTE TÍTULO: qué han hecho con él y qué nota le han puesto.
   Es lo que la ficha de una película y la de un juego enseñan bajo las notas.
   Todas las lecturas pasan por la RLS de amigos de 0015 — un perfil privado, o
   alguien que no es amigo tuyo, simplemente no aporta filas.

   ── Tres fuentes, dos viajes ──────────────────────────────────────────────
   La NOTA no se pide aquí: sale de useFriendsRatings, que ya trae de una vez
   las notas de todos tus amigos y la comparte con la página de gustos y con la
   celda "Amigos" de la propia ficha. Pedirla otra vez por título sería un viaje
   por cada ficha que abras para un dato que ya está en la caché.

   Lo que sí se pide, y solo cuando abres una ficha, son las otras dos:

     · su fila de `library_entries` de ESTE título — con lo que dijeron a mano
       de un juego (estado, "lo tengo", horas);
     · si tienen marcado el episodio sintético (0067, 0071) — o sea, si la han
       visto o se lo han terminado.

   Dos consultas por índice, acotadas al título y a la lista de amigos. No hay
   una tercera para series: el "visto" de una serie son N episodios y contarlos
   por amigo es otra cosa (ver domain/friendTitleStatus). */

/* El `.catch(null)` del estado no es prudencia de más: es la avería de
   lib/kindEnums.test.ts en su otra columna. `play_state` ya creció una vez
   —'backlog' entró en 0078— y zod no ignora un valor que no esté en la lista:
   tira el parseo ENTERO. O sea que el día que se añada un quinto estado, el
   bloque de amigos de todas las fichas se cae de golpe porque UN amigo lo usó.
   Con el `catch`, un estado que este cliente no conoce se lee como "no ha dicho
   nada", que es exactamente lo que era antes de que existiera. */
export const friendEntryRowSchema = z.object({
  user_id: z.string().uuid(),
  followed: z.boolean(),
  owned: z.boolean().nullable().optional(),
  play_state: z.enum(["backlog", "playing", "ongoing", "dropped"]).nullable().optional().catch(null),
  minutes_played: z.number().int().nullable().optional(),
});

const watchRowSchema = z.object({ user_id: z.string().uuid() });

export interface FriendOnTitle {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Su fila de biblioteca, o null si no lo sigue. */
  entry: FriendEntry | null;
  /** La ha visto / se lo ha terminado. */
  finished: boolean;
  /** Su nota, o null si no le ha puesto ninguna. */
  score: number | null;
}

/** Los amigos que tienen algo que decir de este título, ordenados.
 *
 *  Quien no lo sigue, no lo ha visto y no lo ha puntuado NO sale: una lista con
 *  los doce amigos y once "—" no informa de nada. */
export function useFriendsOnTitle({
  titleId,
  episodeId,
  kind,
  tmdbId,
}: {
  titleId: string | null | undefined;
  episodeId: string | null | undefined;
  kind: Medium;
  tmdbId: number;
}) {
  const { data: friendships = [] } = useFriendships();
  const friends = useMemo(
    () => friendships.filter((f) => f.status === "accepted"),
    [friendships],
  );
  const ids = useMemo(() => friends.map((f) => f.other_id), [friends]);
  const { data: allRatings = [] } = useFriendsRatings(ids);

  const { data: entries } = useQuery({
    queryKey: ["friendsOnTitle", "entries", titleId, [...ids].sort()],
    enabled: Boolean(titleId) && ids.length > 0,
    queryFn: async (): Promise<Map<string, FriendEntry>> => {
      const { data, error } = await supabase
        .from("library_entries")
        .select("user_id, followed, owned, play_state, minutes_played")
        .eq("title_id", titleId!)
        .in("user_id", ids);
      if (error) throw error;
      return new Map(
        z.array(friendEntryRowSchema).parse(data ?? []).map((r) => [
          r.user_id,
          {
            followed: r.followed,
            owned: r.owned ?? null,
            playState: r.play_state ?? null,
            minutesPlayed: r.minutes_played ?? null,
          },
        ]),
      );
    },
  });

  const { data: finished } = useQuery({
    queryKey: ["friendsOnTitle", "watched", episodeId, [...ids].sort()],
    enabled: Boolean(episodeId) && ids.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("watch_events")
        .select("user_id")
        .eq("episode_id", episodeId!)
        .in("user_id", ids);
      if (error) throw error;
      return new Set(z.array(watchRowSchema).parse(data ?? []).map((r) => r.user_id));
    },
  });

  return useMemo((): FriendOnTitle[] => {
    /* La nota se cruza por medio Y por número. Un `tmdb_id` solo es único
       dentro de su medio (0067, 0071): sin el `kind`, la nota que tu amigo le
       puso a la SERIE 1399 saldría en la ficha de la película 1399. */
    const scores = new Map(
      allRatings.filter((r) => r.kind === kind && r.tmdb_id === tmdbId).map((r) => [r.user_id, r.score]),
    );
    return friends
      .map((f) => ({
        id: f.other_id,
        name: f.display_name,
        avatarUrl: f.avatar_url,
        entry: entries?.get(f.other_id) ?? null,
        finished: finished?.has(f.other_id) ?? false,
        score: scores.get(f.other_id) ?? null,
      }))
      .filter((f) => f.entry?.followed || f.finished || f.score != null)
      /* Primero quien le puso nota, de más a menos —que es lo que se viene a
         mirar— y a igualdad, por nombre para que la lista no baile entre
         cargas. */
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  }, [friends, entries, finished, allRatings, kind, tmdbId]);
}
