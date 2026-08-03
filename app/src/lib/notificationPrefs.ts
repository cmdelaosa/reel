import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/* Per-type notification preferences. A row is written lazily, on the first
   toggle — so for most users there is no row at all and `defaults` below is what
   they are actually getting. */

/* A type only offers an Email chip where a producer actually sends mail for it:
   new_episode through the daily alerts digest, friend_request through the
   trigger-fired friend-request-email function (0061). Reactions have no sender,
   so their chip is hidden rather than shown inert. */
export type NotificationChannel = "inapp" | "email";

export interface Pref {
  inapp: boolean;
  email: boolean;
}

export interface NotificationTypeSpec {
  type: string;
  label: string;
  sub: string;
  channels: readonly NotificationChannel[];
  /** What an absent row means for this type.
   *
   *  NOT just a client concern — the producers decide the same question on
   *  their own side, and a disagreement is a notification silently sent or
   *  silently dropped. Whatever changes here changes with them:
   *    inapp  → the notify_reaction / notify_friend_request triggers, and the
   *             importer's import_done check
   *    email  → alerts/index.ts (new_episode) and friend-request-email (0061, default in 0063) */
  defaults: Pref;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeSpec[] = [
  // Email off: the digest covers a whole library, so opting in is the user's call.
  { type: "new_episode", label: "New episodes", sub: "Only shows you're watching or waiting for", channels: ["inapp", "email"], defaults: { inapp: true, email: false } },
  // Email ON by default — a friend request is rare, personal, and useless to
  // learn about a week later, which is exactly what mail is for.
  { type: "friend_request", label: "Friend requests", sub: "When someone adds you", channels: ["inapp", "email"], defaults: { inapp: true, email: true } },
  { type: "reaction", label: "Reactions", sub: "When someone reacts to your activity", channels: ["inapp"], defaults: { inapp: true, email: false } },
] as const;

/* For a type no longer listed above (import_done, premiere): everything on, so
   dropping a toggle never silently mutes the thing it used to control. */
const FALLBACK_PREF: Pref = { inapp: true, email: false };

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
  return prefs?.[type] ?? NOTIFICATION_TYPES.find((n) => n.type === type)?.defaults ?? FALLBACK_PREF;
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
