import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { regionCode } from "@/lib/region";

/* Where a title can be watched in the viewer's country — `titles.providers`,
   filled from TMDB's watch/providers by the tmdb-proxy and episode-refresh
   functions (migration 0055).

   Read through a batching loader rather than by widening the RPCs. Ten
   functions return `t.network` today (rpc_up_next, rpc_calendar_feed, the
   library rollup, the history feed, the friend snapshots…) and every one of
   them would need a DROP + CREATE migration to carry one more column, because
   adding an OUT parameter changes a function's return type. Instead every
   component asks for the id it is rendering, the requests made in one tick
   collapse into a single `in.(…)` query, and TanStack Query caches the result
   per title from then on.

   The region is baked into the query key, and changing country reloads the app
   (see SettingsSheet), so a stale batch can never be read against a different
   country's key. */

export interface Provider {
  name: string;
  logoPath: string | null;
}

const rowSchema = z.object({
  tmdb_id: z.number(),
  // `here` is the aliased providers->XX projection: absent country → null.
  here: z
    .array(z.object({ name: z.string(), logo_path: z.string().nullable() }))
    .nullable(),
});

/** Postgres `in.()` lives in the URL, so batches are chunked to keep it well
 *  clear of any proxy's request-line limit. */
const CHUNK = 200;

async function fetchProviders(ids: number[]): Promise<Map<number, Provider[]>> {
  const region = regionCode();
  const out = new Map<number, Provider[]>();

  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("titles")
      // Project one country out of the jsonb instead of shipping every region
      // TMDB knows about for every poster on screen.
      .select(`tmdb_id, here:providers->${region}`)
      .in("tmdb_id", ids.slice(i, i + CHUNK));
    // Swallowed on purpose, unlike every other query in the app (which the
    // global QueryCache.onError surfaces as a toast). This one is decorative
    // and already has a defined empty state: a title with no provider here
    // renders no logo. The failure that matters is the frontend deploying
    // ahead of migration 0055 — the column wouldn't exist, every screen would
    // fetch it, and the honest-looking result would be an error toast on every
    // page instead of the badge slot quietly staying empty.
    if (error) {
      console.warn(`watch providers unavailable: ${error.message}`);
      return out;
    }
    for (const row of z.array(rowSchema).parse(data ?? [])) {
      out.set(
        row.tmdb_id,
        (row.here ?? []).map((p) => ({ name: p.name, logoPath: p.logo_path })),
      );
    }
  }
  return out;
}

let queued: number[] = [];
let batch: Promise<Map<number, Provider[]>> | null = null;

/** Join the batch forming this tick, or open one. */
function loadBatched(tmdbId: number): Promise<Provider[]> {
  queued.push(tmdbId);
  // setTimeout, not queueMicrotask: the ids arrive as React commits a screen's
  // worth of components, which spans more than one microtask checkpoint.
  batch ??= new Promise<Map<number, Provider[]>>((resolve, reject) => {
    setTimeout(() => {
      const ids = [...new Set(queued)];
      queued = [];
      batch = null;
      fetchProviders(ids).then(resolve, reject);
    }, 0);
  });
  // A title we hold no row for reads as "nothing here", same as one with no
  // subscription provider in this country. Both mean: show no logo.
  return batch.then((m) => m.get(tmdbId) ?? []);
}

/** Subscription providers for one title in the viewer's country, best first.
 *  Empty when it isn't available here — which is a real answer, not a gap. */
export function useProviders(tmdbId: number | null | undefined) {
  return useQuery({
    queryKey: qk.providers(regionCode(), tmdbId ?? 0),
    enabled: tmdbId != null,
    // Licences move, but never within a session; the crons re-read TMDB daily.
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: () => loadBatched(tmdbId as number),
  });
}
