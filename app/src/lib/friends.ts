import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useMedium } from "@/lib/medium";
import { useAuth } from "@/features/auth/AuthProvider";

/* Friendships: my friends + incoming/outgoing requests, exact-handle search,
   and request/accept/decline/remove mutations. */

const friendshipSchema = z.object({
  other_id: z.string().uuid(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  status: z.enum(["pending", "accepted"]),
  incoming: z.boolean(),
  watching_title: z.string().nullable(),
  watching_tmdb: z.number().int().nullable(),
  watching_season: z.number().int().nullable(),
  watching_episode: z.number().int().nullable(),
  /* Qué está haciendo con ese título: viéndolo, acabando de verlo, jugándolo o
     terminándoselo (0084). Sin `enum` aquí a propósito: un valor que esta
     versión del cliente no conozca no debe reventar la lista entera de amigos,
     y quien lo interpreta —domain/friendNow— ya sabe caer al verbo del medio.
     Opcional porque la columna llega con una migración que se aplica a mano. */
  activity: z.string().nullable().optional(),
});
export type Friendship = z.infer<typeof friendshipSchema>;

const friendsKey = ["friendships"] as const;

/** Mis amistades, con lo que cada una está haciendo EN EL MEDIO en el que
 *  estás. El medio va en la clave de caché: la lista es la misma gente en los
 *  tres, pero la línea de debajo no, y una sola entrada haría que el modo al
 *  que entraste primero le pusiera el verbo a los otros dos. */
export function useFriendships() {
  const medium = useMedium();
  return useQuery({
    queryKey: [...friendsKey, medium],
    queryFn: async (): Promise<Friendship[]> => {
      const { data, error } = await supabase.rpc("rpc_my_friendships", { p_kind: medium });
      if (error) {
        /* PGRST202 = 0084 aún no aplicada, así que la función que hay es la de
           antes, sin parámetros. Se reintenta sin él en vez de dejar la página
           de Amigos vacía: lo que se pierde mientras tanto es el reparto por
           medio, no la lista. */
        if ((error as { code?: string }).code !== "PGRST202") throw error;
        const legacy = await supabase.rpc("rpc_my_friendships");
        if (legacy.error) throw legacy.error;
        return z.array(friendshipSchema).parse(legacy.data);
      }
      return z.array(friendshipSchema).parse(data);
    },
  });
}

const foundSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
});
export type FoundProfile = z.infer<typeof foundSchema>;

export function useFindProfile() {
  return useMutation({
    mutationFn: async (handle: string): Promise<FoundProfile | null> => {
      const clean = handle.trim().replace(/^@/, "").toLowerCase();
      if (!clean) return null;
      const { data, error } = await supabase.rpc("rpc_find_profile", { p_handle: clean });
      if (error) throw error;
      const rows = z.array(foundSchema).parse(data);
      return rows[0] ?? null;
    },
  });
}

export function useSendRequest() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const me = session!.user.id;
      const [a, b] = me < otherId ? [me, otherId] : [otherId, me];
      const { error } = await supabase
        .from("friendships")
        .insert({ a, b, requested_by: me, status: "pending" });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: friendsKey }),
  });
}

export function useAcceptRequest() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const me = session!.user.id;
      const [a, b] = me < otherId ? [me, otherId] : [otherId, me];
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("a", a)
        .eq("b", b);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: friendsKey }),
  });
}

/** Decline a pending request or remove an accepted friend (delete by either). */
export function useRemoveFriend() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const me = session!.user.id;
      const [a, b] = me < otherId ? [me, otherId] : [otherId, me];
      const { error } = await supabase.from("friendships").delete().eq("a", a).eq("b", b);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: friendsKey }),
  });
}
