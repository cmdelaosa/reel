import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";

/* Notifications inbox: a query over the caller's rows + a Realtime subscription
   that prepends new inserts live. */

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** Inbox query — callable from anywhere (Shell badge, NotifPanel). */
export function useNotifications() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, payload, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return z.array(notificationSchema).parse(data);
    },
  });
}

/** Realtime subscription — mount ONCE (in the Shell). Prepends inserts live. */
export function useNotificationsRealtime() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    // Unique channel name per mount so HMR / StrictMode re-mounts never collide
    // with a still-subscribed channel of the same topic.
    const channel = supabase.channel(`notifications:${userId}:${Math.random().toString(36).slice(2)}`);
    channel
      .on(
        // Not just INSERT: a reaction notification is one row per event that
        // gets rewritten as people pile on (0058), and it disappears again if
        // they all withdraw.
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const goneId = (payload.old as { id?: string }).id;
            if (!goneId) return;
            queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) =>
              old.filter((n) => n.id !== goneId),
            );
            // A deleted row carries only its id, so the type is unknowable —
            // and the one type that deletes itself is a reaction being
            // withdrawn. Cheap query, rare event: just refetch it.
            queryClient.invalidateQueries({ queryKey: ["eventReactions"] });
            return;
          }
          const row = notificationSchema.safeParse(payload.new);
          if (!row.success) return;
          // Somebody reacted to a row of yours. The chips on screen were
          // fetched before that happened — including on the feed this very
          // notification links into.
          if (row.data.type === "reaction") {
            queryClient.invalidateQueries({ queryKey: ["eventReactions"] });
          }
          queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) =>
            // A rewritten row carries a fresh created_at, so re-sorting floats
            // it back to the top the way a brand-new one arrives there.
            [row.data, ...old.filter((n) => n.id !== row.data.id)].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const now = new Date().toISOString();
      let q = supabase.from("notifications").update({ read_at: now }).is("read_at", null);
      if (ids && ids.length) q = q.in("id", ids);
      else q = q.eq("user_id", session!.user.id);
      const { error } = await q;
      if (error) throw error;
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.notifications });
      const prev = queryClient.getQueryData<Notification[]>(qk.notifications);
      const now = new Date().toISOString();
      queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) =>
        old.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(qk.notifications, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
}
