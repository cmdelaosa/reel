import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";
import { type ReactionRow } from "@/domain/reactions";

/* Reactions on activity-feed rows — the data half (the palette and the folding
   live in domain/reactions.ts).

   Reactions are fetched apart from the feed itself on purpose: the feed unions
   three sources across everyone in your circle and changes by the hour, while
   reactions change every time somebody taps. Splitting them means a tap
   refetches the cheap query and leaves the expensive one cached. */

const rowSchema = z.object({
  event_key: z.string(),
  emoji: z.string(),
  user_id: z.string().uuid(),
  // Null for a private profile you have no claim on — see rpc_event_reactions.
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
});

/** Every reaction on a page of feed rows, including reactions left by people
 *  you are not friends with — rpc_event_reactions gates on the event, not on
 *  the reactor, so the counts you see are the real ones. */
export function useEventReactions(keys: string[]) {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.eventReactions(keys),
    enabled: keys.length > 0 && Boolean(session?.user.id),
    // Revealing ten more rows changes the key. Without this the chips already
    // on screen would blank out until the new page's fetch came back.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<ReactionRow[]> => {
      const { data, error } = await supabase.rpc("rpc_event_reactions", { p_keys: keys });
      if (error) throw error;
      return z.array(rowSchema).parse(data);
    },
  });
}

/** Set, change, or withdraw (emoji = null) the caller's reaction on a row.
 *  Only the event's key travels: whose event it is and which show it is about
 *  are derived from that key server-side (0058), so there is nothing here a
 *  caller could get wrong — or lie about. */
export function useSetReaction() {
  const qc = useQueryClient();
  const { session, profile } = useAuth();
  const me = session?.user.id;

  /** Cached pages that actually contain this event — the optimistic row has no
   *  business in any other, and writing into a page still in flight would
   *  fabricate a result for it. */
  const pagesWith = (eventKey: string) => ({
    queryKey: qk.reactions,
    predicate: (q: { queryKey: readonly unknown[] }) =>
      Array.isArray(q.queryKey[1]) && (q.queryKey[1] as string[]).includes(eventKey),
  });

  return useMutation({
    mutationFn: async ({ eventKey, emoji }: { eventKey: string; emoji: string | null }) => {
      if (!emoji) {
        const { error } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("user_id", me!)
          .eq("event_key", eventKey);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("activity_reactions").upsert(
        { event_key: eventKey, user_id: me!, emoji, updated_at: new Date().toISOString() },
        { onConflict: "user_id,event_key" },
      );
      if (error) throw error;
    },

    // Optimistic: the chip has to answer the tap now, and a round trip through
    // Postgres is long enough to feel like a miss.
    onMutate: async ({ eventKey, emoji }) => {
      await qc.cancelQueries(pagesWith(eventKey));
      const prev = qc.getQueriesData<ReactionRow[]>(pagesWith(eventKey));
      qc.setQueriesData<ReactionRow[]>(pagesWith(eventKey), (rows) => {
        // Never seed an unresolved page: it would flip to "success" holding one
        // invented row, and the rollback below cannot undo an undefined→value
        // write (setQueryData treats an undefined restore as a no-op).
        if (!rows) return rows;
        const others = rows.filter((r) => !(r.user_id === me && r.event_key === eventKey));
        if (!emoji) return others;
        return [
          ...others,
          {
            event_key: eventKey,
            emoji,
            user_id: me!,
            display_name: profile?.display_name ?? null,
            avatar_url: profile?.avatar_url ?? null,
            created_at: new Date().toISOString(),
          },
        ];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, rows] of ctx?.prev ?? []) qc.setQueryData(key, rows);
    },
    onSettled: (_d, _e, { eventKey }) => qc.invalidateQueries(pagesWith(eventKey)),
  });
}
