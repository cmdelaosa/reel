import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/features/auth/AuthProvider";

/* Watch mutations — optimistic against qk.watched(titleId) (the episode_id →
   watch_event id map the detail sheet renders), invalidating the derived
   queries (library buckets, up next, stats) on settle. */

type WatchedMap = Map<string, string>;

function invalidateDerived(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.library });
  qc.invalidateQueries({ queryKey: qk.upNext });
  qc.invalidateQueries({ queryKey: qk.stats });
  qc.invalidateQueries({ queryKey: ["calendarFeed"] });
  qc.invalidateQueries({ queryKey: qk.history });
}

function invalidateDetail(qc: ReturnType<typeof useQueryClient>, titleId: string) {
  qc.invalidateQueries({ queryKey: qk.watched(titleId) });
  qc.invalidateQueries({ queryKey: qk.detailProgress(titleId) });
}

/* Tracking an episode of a show you don't follow auto-adds it to the library.
   The one exception: a show you explicitly hit "Stop watching" on stays
   stopped — marking old episodes there must not resurrect it. */
async function ensureFollowed(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
  titleId: string,
) {
  // Shows in the library rollup cache are already followed — skip the trip.
  const lib = qc.getQueryData<{ title_id: string }[]>(qk.library);
  if (lib?.some((r) => r.title_id === titleId)) return;

  const { data, error } = await supabase
    .from("library_entries")
    .select("followed, stopped")
    .eq("user_id", userId)
    .eq("title_id", titleId)
    .maybeSingle();
  if (error || data?.stopped || data?.followed) return;

  await supabase.from("library_entries").upsert(
    { user_id: userId, title_id: titleId, followed: true },
    { onConflict: "user_id,title_id" },
  );
}

export function useMarkWatched(titleId: string) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (episodeId: string) => {
      const { data, error } = await supabase
        .from("watch_events")
        .insert({ user_id: session!.user.id, episode_id: episodeId })
        .select("id")
        .single();
      if (error) throw error;
      // Before onSettled's library invalidation so the refetch sees the follow.
      await ensureFollowed(qc, session!.user.id, titleId).catch(() => {});
      return data.id as string;
    },
    onMutate: async (episodeId) => {
      await qc.cancelQueries({ queryKey: qk.watched(titleId) });
      const prev = qc.getQueryData<WatchedMap>(qk.watched(titleId));
      qc.setQueryData<WatchedMap>(qk.watched(titleId), (old) => {
        const next = new Map(old ?? []);
        next.set(episodeId, "optimistic");
        return next;
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.watched(titleId), ctx?.prev),
    onSettled: () => {
      invalidateDetail(qc, titleId);
      invalidateDerived(qc);
    },
  });
}

export function useUnmarkWatched(titleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (watchEventId: string) => {
      const { error } = await supabase.from("watch_events").delete().eq("id", watchEventId);
      if (error) throw error;
    },
    onMutate: async (watchEventId) => {
      await qc.cancelQueries({ queryKey: qk.watched(titleId) });
      const prev = qc.getQueryData<WatchedMap>(qk.watched(titleId));
      qc.setQueryData<WatchedMap>(qk.watched(titleId), (old) => {
        const next = new Map(old ?? []);
        for (const [ep, id] of next) if (id === watchEventId) next.delete(ep);
        return next;
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.watched(titleId), ctx?.prev),
    onSettled: () => {
      invalidateDetail(qc, titleId);
      invalidateDerived(qc);
    },
  });
}

const idsSchema = z.array(z.string().uuid());

/** Bulk "mark up to here" — single RPC; resolves with the created event ids
 *  (for Undo). */
export function useMarkUpTo(titleId: string) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (episodeId: string): Promise<string[]> => {
      const { data, error } = await supabase.rpc("rpc_mark_up_to", { p_episode_id: episodeId });
      if (error) throw error;
      await ensureFollowed(qc, session!.user.id, titleId).catch(() => {});
      return idsSchema.parse(data ?? []);
    },
    onSettled: () => {
      invalidateDetail(qc, titleId);
      invalidateDerived(qc);
    },
  });
}

/** Undo a bulk mark: delete exactly the created events. */
export function useUndoMarks(titleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (watchEventIds: string[]) => {
      const { error } = await supabase.from("watch_events").delete().in("id", watchEventIds);
      if (error) throw error;
    },
    onSettled: () => {
      invalidateDetail(qc, titleId);
      invalidateDerived(qc);
    },
  });
}
