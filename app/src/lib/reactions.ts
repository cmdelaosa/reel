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
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
});

/** Every reaction on a page of feed rows, including reactions left by people
 *  you are not friends with — rpc_event_reactions gates on the event, not on
 *  the reactor, so the counts you see are the real ones. */
export function useEventReactions(keys: string[]) {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.eventReactions(keys[0] ?? "", keys.length),
    enabled: keys.length > 0 && Boolean(session?.user.id),
    queryFn: async (): Promise<ReactionRow[]> => {
      const { data, error } = await supabase.rpc("rpc_event_reactions", { p_keys: keys });
      if (error) throw error;
      return z.array(rowSchema).parse(data);
    },
  });
}

/** What a reaction needs to know about the row it lands on: the event's name,
 *  whose event it is (RLS checks it, and the notification goes there), and the
 *  show it is about (the notification quotes it). */
export interface ReactionTarget {
  eventKey: string;
  actorId: string;
  titleId: string;
}

/** Set, change, or withdraw (emoji = null) the caller's reaction on a row. */
export function useSetReaction() {
  const qc = useQueryClient();
  const { session, profile } = useAuth();
  const me = session?.user.id;

  return useMutation({
    mutationFn: async ({ target, emoji }: { target: ReactionTarget; emoji: string | null }) => {
      if (!emoji) {
        const { error } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("user_id", me!)
          .eq("event_key", target.eventKey);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("activity_reactions").upsert(
        {
          event_key: target.eventKey,
          user_id: me!,
          actor_id: target.actorId,
          title_id: target.titleId,
          emoji,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,event_key" },
      );
      if (error) throw error;
    },

    // Optimistic across every cached page: the chip has to answer the tap now,
    // and a round trip through Postgres is long enough to feel like a miss.
    onMutate: async ({ target, emoji }) => {
      await qc.cancelQueries({ queryKey: ["eventReactions"] });
      const prev = qc.getQueriesData<ReactionRow[]>({ queryKey: ["eventReactions"] });
      qc.setQueriesData<ReactionRow[]>({ queryKey: ["eventReactions"] }, (rows = []) => {
        const others = rows.filter((r) => !(r.user_id === me && r.event_key === target.eventKey));
        if (!emoji) return others;
        return [
          ...others,
          {
            event_key: target.eventKey,
            emoji,
            user_id: me!,
            display_name: profile?.display_name ?? "",
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["eventReactions"] }),
  });
}
