import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { createBatcher } from "@/lib/batch";
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
  kind: z.enum(["tv", "movie"]),
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

/* La clave del lote es "medio:id", no el id a secas. Un id de TMDB solo es
   único dentro de su medio (0067): pedir el 1399 sin decir cuál trae las dos
   filas, y el Map se quedaba con la que llegase última — la película de 1978
   con los logos de Juego de Tronos, o al revés. Un lote puede llevar los dos
   medios mezclados (una rejilla de cine con la barra de amigos al lado), así
   que se agrupan y sale una consulta por medio presente. */
export type ProviderKey = `${"tv" | "movie"}:${number}`;

const parseKey = (k: ProviderKey): { kind: string; tmdbId: number } => {
  const [kind, id] = k.split(":");
  return { kind, tmdbId: Number(id) };
};

async function fetchProviders(keys: ProviderKey[]): Promise<Map<ProviderKey, Provider[]>> {
  const region = regionCode();
  const byKind = new Map<string, number[]>();
  for (const key of keys) {
    const { kind, tmdbId } = parseKey(key);
    const held = byKind.get(kind);
    if (held) held.push(tmdbId);
    else byKind.set(kind, [tmdbId]);
  }
  const chunks: { kind: string; ids: number[] }[] = [];
  for (const [kind, ids] of byKind) {
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push({ kind, ids: ids.slice(i, i + CHUNK) });
  }

  // In parallel: the chunks are independent, and awaiting them in sequence
  // just makes a large grid wait a second round trip for its badges.
  const responses = await Promise.all(
    chunks.map(({ kind, ids }) =>
      supabase
        .from("titles")
        // Project one country out of the jsonb instead of shipping every
        // region TMDB knows about for every poster on screen.
        .select(`tmdb_id, kind, here:providers->${region}`)
        .eq("kind", kind)
        .in("tmdb_id", ids),
    ),
  );

  const out = new Map<ProviderKey, Provider[]>();
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
        `${row.kind}:${row.tmdb_id}`,
        (row.here ?? []).map((p) => ({ name: p.name, logoPath: p.logo_path })),
      );
    }
  }
  return out;
}

/* A title we hold no row for resolves to [] — the same answer as one with no
   subscription provider in this country. Both mean: draw no logo. */
const loadBatched = createBatcher(fetchProviders);

/** Subscription providers for one title in the viewer's country, best first.
 *  Empty when it isn't available here — which is a real answer, not a gap. */
export function useProviders(tmdbId: number | null | undefined, kind: "tv" | "movie" = "tv") {
  return useQuery({
    queryKey: qk.providers(regionCode(), kind, tmdbId ?? 0),
    enabled: tmdbId != null,
    // Licences move, but never within a session; the crons re-read TMDB daily.
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: () => loadBatched(`${kind}:${tmdbId as number}`),
  });
}
