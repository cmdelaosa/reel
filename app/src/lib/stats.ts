import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { t } from "@/lib/i18n";
import type { HeatRow } from "@/domain/heatmap";

const statsSchema = z.object({
  episodes_watched: z.number().int(),
  /* Las dos cifras de cine (0069) se desdoblan en vez de sumarse a las de
     series: contar una película como episodio es lo que hacía falsa la
     etiqueta. Opcionales, como todo lo que llega con una migración que se
     aplica a mano después de que el frontend ya esté fuera. */
  movies_watched: z.number().int().optional().default(0),
  /* Y las tres de juegos (0074), por lo mismo. `minutes_played` va aparte de
     `minutes_watched` y no sumada: un juego no dura cuarenta minutos, que es
     justo lo que aquella suma le habría inventado a cada uno (0071). */
  games_finished: z.number().int().optional().default(0),
  minutes_watched: z.number().int(),
  minutes_played: z.number().int().optional().default(0),
  shows_followed: z.number().int(),
  movies_followed: z.number().int().optional().default(0),
  games_followed: z.number().int().optional().default(0),
  coming_soon: z.number().int(),
  avg_rating: z.number().nullable(),
  friends: z.number().int(),
});
export type UserStats = z.infer<typeof statsSchema>;

export function useUserStats() {
  return useQuery({
    queryKey: qk.stats,
    queryFn: async (): Promise<UserStats> => {
      const { data, error } = await supabase.rpc("rpc_user_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return statsSchema.parse(row);
    },
  });
}

/* La rejilla de actividad se pide POR MEDIO (0082) y cae a la de siempre
   mientras esa migración no esté aplicada. Las dos formas se normalizan aquí a
   `HeatRow`, con `kind: null` en el respaldo: quien pinta no tiene que saber
   por cuál de las dos funciones vino, solo si sabe de qué fue el día.

   Rellenar ese null con "tv" habría sido lo cómodo y lo equivocado — teñiría
   de coral el año entero de quien solo juega. Ver domain/heatmap. */
const kindsSchema = z.array(z.object({
  day: z.string(),
  kind: z.enum(["tv", "movie", "game"]),
  n: z.number().int(),
}));
const heatmapSchema = z.array(z.object({ day: z.string(), n: z.number().int() }));
export type HeatmapDay = z.infer<typeof heatmapSchema>[number];

/** Per-day watch counts for the profile heatmap, bucketed in the local tz.
 *  Omit `userId` for your own history; pass a friend's id for theirs — the RPC
 *  is security invoker, so the 0015 friend-read policy on watch_events decides
 *  what comes back (a non-friend or private profile yields nothing). */
export function useWatchHeatmap(days: number, userId?: string) {
  return useQuery({
    // `days` belongs in the key: it decides how much history the RPC returns,
    // so an entry cached under a narrower window would otherwise be served to a
    // wider grid — the 26→53 week change left friend grids drawing a rolling
    // year over half a year of data, blank until mid-January.
    queryKey: [...qk.watchHeatmap, userId ?? "me", days],
    queryFn: async (): Promise<HeatRow[] | null> => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      // Only send p_user when targeting someone else, so the own-profile call
      // still matches the pre-0048 two-arg signature on a database that hasn't
      // had the migration applied yet.
      const args = userId ? { days, tz, p_user: userId } : { days, tz };

      const byKind = await supabase.rpc("rpc_watch_heatmap_kinds", args);
      if (!byKind.error) return kindsSchema.parse(byKind.data ?? []);
      // Cualquier error que no sea "esa función todavía no existe" es un error
      // de verdad y no se disfraza de rejilla monocroma.
      if ((byKind.error as { code?: string }).code !== "PGRST202") throw byKind.error;

      const { data, error } = await supabase.rpc("rpc_watch_heatmap", args);
      // PGRST202 = this signature isn't deployed yet. The grid is an extra, so
      // null (→ the component renders nothing) beats throwing, which would also
      // fire the global query-error toast on every friend page.
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return null;
        throw error;
      }
      return heatmapSchema.parse(data ?? []).map((r) => ({ ...r, kind: null }));
    },
  });
}

/** "77 days" style label for a minute total. */
export function timeSpentLabel(minutes: number): string {
  const days = minutes / 60 / 24;
  if (days >= 1) return `${Math.round(days)} ${t("days")}`;
  const hours = minutes / 60;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${minutes}m`;
}
