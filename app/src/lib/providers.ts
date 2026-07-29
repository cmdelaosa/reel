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

/** True for the one failure we answer with silence: the column not existing.
 *
 *  The frontend deploys itself on push while `supabase db push` is manual, so
 *  there is a window where the app asks for a column the database hasn't got.
 *  Answering that with "no providers" keeps the badge slot quietly empty
 *  instead of firing the global error toast on every screen. Every *other*
 *  failure is a real one and must propagate: swallowing a dropped connection
 *  would cache "not available in your country" — a confident, wrong answer —
 *  for the whole staleTime below, with no retry and no toast. */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  // 42703 = undefined_column (Postgres); PGRST204 is PostgREST's own variant.
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .*providers.* does not exist/i.test(error.message ?? "");
}

async function fetchProviders(ids: number[]): Promise<Map<number, Provider[]>> {
  const region = regionCode();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  // In parallel: the chunks are independent, and awaiting them in sequence
  // just makes a large grid wait a second round trip for its badges.
  const responses = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("titles")
        // Project one country out of the jsonb instead of shipping every
        // region TMDB knows about for every poster on screen.
        .select(`tmdb_id, here:providers->${region}`)
        .in("tmdb_id", chunk),
    ),
  );

  const out = new Map<number, Provider[]>();
  for (const { data, error } of responses) {
    if (error) {
      if (!isMissingColumn(error)) throw error;
      console.warn(`watch providers unavailable: ${error.message}`);
      // Whole-batch empty, not partial: a half-filled map would cache the
      // missing half as "not available here" while its neighbours rendered.
      return new Map();
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

/** Collapse the id lookups made in one tick into a single `fetchMany` call.
 *
 *  `fetchMany` is a parameter rather than a direct import so the mechanics
 *  below — which are the fiddly part: a queue and a flush that both reset
 *  before the fetch resolves — are testable without mocking the Supabase
 *  client, which nothing else in this codebase does. */
export function createBatcher<T>(
  fetchMany: (ids: number[]) => Promise<Map<number, T[]>>,
): (id: number) => Promise<T[]> {
  let queued: number[] = [];
  let batch: Promise<Map<number, T[]>> | null = null;

  return (id: number): Promise<T[]> => {
    queued.push(id);
    // setTimeout, not queueMicrotask: the ids arrive as React commits a
    // screen's worth of components, which spans more than one microtask
    // checkpoint. Nothing may await between the push above and the assignment
    // below, or an id could land in a queue whose promise the caller doesn't
    // hold.
    batch ??= new Promise<Map<number, T[]>>((resolve, reject) => {
      setTimeout(() => {
        const ids = [...new Set(queued)];
        queued = [];
        batch = null;
        fetchMany(ids).then(resolve, reject);
      }, 0);
    });
    // A title we hold no row for reads as "nothing here", same as one with no
    // subscription provider in this country. Both mean: show no logo.
    return batch.then((m) => m.get(id) ?? []);
  };
}

const loadBatched = createBatcher(fetchProviders);

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
