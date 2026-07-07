import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
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
});
export type Friendship = z.infer<typeof friendshipSchema>;

const friendsKey = ["friendships"] as const;

export function useFriendships() {
  return useQuery({
    queryKey: friendsKey,
    queryFn: async (): Promise<Friendship[]> => {
      const { data, error } = await supabase.rpc("rpc_my_friendships");
      if (error) throw error;
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
