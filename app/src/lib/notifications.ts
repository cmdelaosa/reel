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
            // 0058 sets `replica identity full` on this table, so a delete
            // arrives with its whole old row — the subscription's user_id
            // filter has something to match, which under the default identity
            // (primary key only) it did not.
            const gone = payload.old as { id?: string; type?: string };
            if (!gone.id) return;
            queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) =>
              old.filter((n) => n.id !== gone.id),
            );
            // The full old row means the type is knowable, so emptying an inbox
            // of fifty doesn't fire fifty refetches of the feed's chips.
            if (gone.type === "reaction") {
              queryClient.invalidateQueries({ queryKey: qk.reactions });
            }
            return;
          }
          const row = notificationSchema.safeParse(payload.new);
          if (!row.success) return;
          // Somebody reacted to a row of yours: the chips on screen were
          // fetched before that happened, including on the feed this very
          // notification links into. Only for a row that comes in UNREAD —
          // "mark all read" echoes one update per row through here, and none of
          // them changes a single reaction.
          if (row.data.type === "reaction" && !row.data.read_at) {
            queryClient.invalidateQueries({ queryKey: qk.reactions });
          }
          queryClient.setQueryData<Notification[]>(qk.notifications, (old = []) => {
            const known = old.some((n) => n.id === row.data.id);
            // An update to a row outside the fetched window is not ours to add;
            // marking 200 notifications read would otherwise grow the panel to
            // 200 rows, well past the 50 it asked for.
            if (!known && payload.eventType === "UPDATE") return old;
            // A rewritten row carries a fresh created_at, so re-sorting floats
            // it back to the top the way a brand-new one arrives there.
            return [row.data, ...old.filter((n) => n.id !== row.data.id)].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            );
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

/** Empty the inbox. Reading a notification never removed it — the importer's
 *  "import finished" rows in particular piled up until they filled the panel's
 *  50-row window — and RLS has allowed the owner to delete since 0004. */
export function useClearNotifications() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("user_id", session!.user.id);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: qk.notifications });
      const prev = queryClient.getQueryData<Notification[]>(qk.notifications);
      queryClient.setQueryData<Notification[]>(qk.notifications, []);
      return { prev };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(qk.notifications, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
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
