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
    const channel = supabase.channel(`notifications:${userId}`);
    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = notificationSchema.safeParse(payload.new);
          if (!row.success) return;
          queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) =>
            old.some((n) => n.id === row.data.id) ? old : [row.data, ...old],
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
