// episode-refresh — scheduled edge function (P2-C8).
//
// For every DISTINCT followed title (any user): refresh the title row (status,
// dates, scores) and the latest two regular seasons' episodes from TMDB,
// upserting diffs into the metadata cache. Titles refreshed < 20h ago are
// skipped, so a daily schedule self-heals without hammering TMDB. Rate-limited
// to ≤ 40 TMDB requests per 10s (fixed window — mirrors the unit-tested
// planner in app/src/domain/rateLimit.ts).
//
// AUTH: headless job — requires the service-role key as the bearer token.
//
// SCHEDULING (documented choice: pg_cron on hosted):
//   select cron.schedule('episode-refresh-daily', '0 5 * * *', $$
//     select net.http_post(
//       url    := 'https://<ref>.supabase.co/functions/v1/episode-refresh',
//       headers:= jsonb_build_object('Authorization', 'Bearer ' || <service key from vault>)
//     ) $$);
//   Locally: invoke manually — `supabase functions serve episode-refresh
//   --env-file supabase/.env` + curl with the local service key.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TMDB = "https://api.themoviedb.org/3";
const AIR_TIME = "T21:00:00Z";
const STALE_MS = 20 * 60 * 60 * 1000; // 20h
const LIMIT = 40;
const WINDOW_MS = 10_000;

// deno-lint-ignore no-explicit-any
type Any = any;

// -- fixed-window limiter (mirror of app/src/domain/rateLimit.ts) -------------
let winStart = 0;
let winUsed = 0;
async function throttle() {
  const now = Date.now();
  if (now - winStart >= WINDOW_MS) {
    winStart = now;
    winUsed = 1;
    return;
  }
  if (winUsed < LIMIT) {
    winUsed++;
    return;
  }
  const wait = winStart + WINDOW_MS - now;
  await new Promise((r) => setTimeout(r, wait));
  winStart += WINDOW_MS;
  winUsed = 1;
}

async function tmdb(key: string, path: string): Promise<Any> {
  await throttle();
  const res = await fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`);
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json();
}

const airDatetime = (d?: string | null) => (d ? `${d}${AIR_TIME}` : null);

async function refreshTitle(admin: SupabaseClient, key: string, row: { id: string; tmdb_id: number }) {
  const d = await tmdb(key, `/tv/${row.tmdb_id}`);
  const { error: te } = await admin
    .from("titles")
    .update({
      name: d.name ?? "Untitled",
      overview: d.overview ?? null,
      poster_path: d.poster_path ?? null,
      backdrop_path: d.backdrop_path ?? null,
      first_air_date: d.first_air_date || null,
      status: d.status ?? null,
      genres: (d.genres ?? []).map((g: Any) => g.name),
      network: d.networks?.[0]?.name ?? null,
      episode_run_time: d.episode_run_time?.[0] ?? null,
      vote_average: d.vote_average ?? null,
      popularity: d.popularity ?? null,
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (te) throw new Error(`title update: ${te.message}`);

  const latest = (d.seasons ?? [])
    .filter((s: Any) => (s.season_number as number) > 0)
    .sort((a: Any, b: Any) => b.season_number - a.season_number)
    .slice(0, 2);

  for (const s of latest) {
    const { data: season, error: se } = await admin
      .from("seasons")
      .upsert(
        {
          title_id: row.id,
          tmdb_id: s.id ?? null,
          number: s.season_number,
          name: s.name ?? null,
          episode_count: s.episode_count ?? null,
          air_date: s.air_date || null,
        },
        { onConflict: "title_id,number" },
      )
      .select("id")
      .single();
    if (se || !season) throw new Error(`season upsert: ${se?.message}`);

    const sd = await tmdb(key, `/tv/${row.tmdb_id}/season/${s.season_number}`);
    const eps = (sd.episodes ?? []).map((e: Any) => ({
      title_id: row.id,
      season_id: season.id,
      tmdb_id: e.id ?? null,
      season_number: e.season_number,
      episode_number: e.episode_number,
      name: e.name ?? null,
      overview: e.overview ?? null,
      runtime: e.runtime ?? null,
      air_datetime: airDatetime(e.air_date),
    }));
    if (eps.length) {
      const { error: ee } = await admin
        .from("episodes")
        .upsert(eps, { onConflict: "title_id,season_number,episode_number" });
      if (ee) throw new Error(`episodes upsert: ${ee.message}`);
    }
  }
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const tmdbKey = Deno.env.get("TMDB_API_KEY");
  if (!tmdbKey) {
    return new Response(JSON.stringify({ error: "TMDB_API_KEY not configured" }), { status: 500 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // distinct followed titles (service role sees all users). The !inner embed
  // filters titles to those with ≥1 followed entry — parent rows stay unique,
  // and no giant `.in(id, …)` URI is needed.
  const { data: titles, error: te } = await admin
    .from("titles")
    .select("id, tmdb_id, last_refreshed_at, library_entries!inner(followed)")
    .eq("library_entries.followed", true);
  if (te) return new Response(JSON.stringify({ error: te.message }), { status: 500 });
  const ids = (titles ?? []).map((t: Any) => t.id);

  const cutoff = Date.now() - STALE_MS;
  const stale = (titles ?? []).filter(
    (t: Any) => !t.last_refreshed_at || new Date(t.last_refreshed_at).getTime() < cutoff,
  );

  // Respond immediately and refresh in the background (EdgeRuntime.waitUntil)
  // so the gateway's request timeout never truncates a big backfill. A wall
  // guard stops before the runtime's hard limit; leftovers stay stale and the
  // next scheduled run picks them up (refreshTitle is idempotent).
  const MAX_MS = 330_000;
  const started = Date.now();

  const work = (async () => {
    let refreshed = 0;
    const errors: string[] = [];
    for (const t of stale) {
      if (Date.now() - started > MAX_MS) break;
      try {
        await refreshTitle(admin, tmdbKey, t);
        refreshed++;
      } catch (err) {
        errors.push(`${t.tmdb_id}: ${String(err)}`);
      }
    }
    console.log(
      `episode-refresh done: ${refreshed}/${stale.length} refreshed, ${errors.length} errors`,
      errors.slice(0, 5),
    );
  })();

  // Respond immediately and let the backfill run in the background where the
  // runtime supports it; otherwise await inline. (waitUntil() returns void, so
  // `?? await` would always run inline — must branch explicitly.)
  // deno-lint-ignore no-explicit-any
  const edge = (globalThis as Any).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
  else await work;

  return new Response(
    JSON.stringify({
      followedTitles: ids.length,
      stale: stale.length,
      skipped: (titles ?? []).length - stale.length,
      processing: stale.length > 0,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
