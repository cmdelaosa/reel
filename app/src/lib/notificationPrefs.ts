import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/* Per-type notification preferences. Absent row = default (in-app on, email
   off) — materialized lazily on first toggle. */

export const NOTIFICATION_TYPES = [
  { type: "new_episode", label: "New episodes", sub: "When a show you follow airs" },
  { type: "premiere", label: "Premieres", sub: "When a followed upcoming show gets a date" },
  { type: "friend_request", label: "Friend requests", sub: "When someone adds you" },
  { type: "import_done", label: "Imports", sub: "When a TV Time import finishes" },
] as const;

export interface Pref {
  inapp: boolean;
  email: boolean;
}
const DEFAULT_PREF: Pref = { inapp: true, email: false };

const prefRowSchema = z.object({ type: z.string(), inapp: z.boolean(), email: z.boolean() });

const prefsKey = ["notificationPrefs"] as const;

export function useNotificationPrefs() {
  const { session } = useAuth();
  return useQuery({
    queryKey: prefsKey,
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<Record<string, Pref>> => {
      const { data, error } = await supabase.from("notification_prefs").select("type, inapp, email");
      if (error) throw error;
      const map: Record<string, Pref> = {};
      for (const r of z.array(prefRowSchema).parse(data)) map[r.type] = { inapp: r.inapp, email: r.email };
      return map;
    },
  });
}

export function prefFor(prefs: Record<string, Pref> | undefined, type: string): Pref {
  return prefs?.[type] ?? DEFAULT_PREF;
}

export function useSetPref() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ type, pref }: { type: string; pref: Pref }) => {
      const { error } = await supabase.from("notification_prefs").upsert(
        { user_id: session!.user.id, type, inapp: pref.inapp, email: pref.email },
        { onConflict: "user_id,type" },
      );
      if (error) throw error;
    },
    onMutate: async ({ type, pref }) => {
      await qc.cancelQueries({ queryKey: prefsKey });
      const prev = qc.getQueryData<Record<string, Pref>>(prefsKey);
      qc.setQueryData<Record<string, Pref>>(prefsKey, (old = {}) => ({ ...old, [type]: pref }));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(prefsKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: prefsKey }),
  });
}
