// importer — in-app TV Time zip importer (P3-C4).
//
// The client uploads a zip to storage `imports/<uid>/<job>.zip`, inserts an
// import_jobs(pending) row, then invokes this with { job_id, path }. We verify
// the caller, download + unzip + parse the export, import the user's follow +
// watch state (shared core in scripts/tvtime-import/lib.ts), and update the job
// to done with a report, then drop an import_done notification. Idempotent —
// unique watch_events + upserts absorb re-runs.
//
// Long imports run under EdgeRuntime.waitUntil with a wall guard; the client
// polls import_jobs and may re-invoke to continue (re-runs skip nothing but are
// safe). Requires a real user JWT.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipCsvs, parseShows, parseWatches, parseArchived, runImport, NotATvTimeExport } from "../../../scripts/tvtime-import/lib.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });

const WALL_MS = 240_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tmdbKey = Deno.env.get("TMDB_API_KEY");

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  // Invite gate: un-invited accounts cannot run imports (row/storage quota burn).
  const { data: invited } = await userClient.rpc("is_invited", { uid: user.id });
  if (!invited) return json({ error: "not invited" }, 403);
  if (!tmdbKey) return json({ error: "TMDB_API_KEY not configured" }, 500);

  const { job_id, path } = await req.json().catch(() => ({}));
  if (!job_id || !path) return json({ error: "job_id and path required" }, 400);

  const admin: SupabaseClient = createClient(url, service);

  // The uploaded object must live under the caller's own folder.
  if (!String(path).startsWith(`${user.id}/`)) return json({ error: "forbidden path" }, 403);

  // The job row must belong to the caller (service-role writes bypass RLS, so
  // verify ownership before touching it — otherwise a caller could overwrite
  // another user's import_jobs row).
  const { data: jobRow } = await admin.from("import_jobs").select("user_id").eq("id", job_id).maybeSingle();
  if (!jobRow || jobRow.user_id !== user.id) return json({ error: "job not found" }, 404);

  const fail = async (message: string, status = 400) => {
    await admin.from("import_jobs").update({ status: "error", report: { error: message }, finished_at: new Date().toISOString() }).eq("id", job_id);
    return json({ error: message }, status);
  };

  const { data: blob, error: dlErr } = await admin.storage.from("imports").download(path);
  if (dlErr || !blob) return fail(`could not read upload: ${dlErr?.message ?? "missing"}`);

  let shows, watches, archived;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const csvs = unzipCsvs(bytes);
    shows = parseShows(csvs);
    watches = parseWatches(csvs); // exact per-episode history; empty map → counter fallback
    archived = parseArchived(csvs); // TV Time "archived" → stopped
  } catch (err) {
    return fail(err instanceof NotATvTimeExport ? err.message : `unreadable zip: ${String(err)}`);
  }
  if (shows.length === 0) return fail("no shows found in export");

  await admin.from("import_jobs").update({ status: "running", report: { total: shows.length, done: 0 } }).eq("id", job_id);

  const started = Date.now();
  const work = (async () => {
    const report = await runImport(admin, tmdbKey, user.id, shows, watches, archived, (done, r) => {
      if (Date.now() - started > WALL_MS) throw new Error("__wall__");
      if (done % 10 === 0) {
        admin.from("import_jobs")
          .update({ report: { total: shows.length, done, matched: r.matched, watch_events: r.watchEvents } })
          .eq("id", job_id)
          .then(() => {}, () => {}); // fire-and-forget progress; never let a blip reject the isolate
      }
    }).catch((e) => (e?.message === "__wall__" ? "__wall__" : Promise.reject(e)));

    if (report === "__wall__") {
      // hit the wall — leave as running; client re-invokes to continue
      await admin.from("import_jobs").update({ status: "running" }).eq("id", job_id);
      return;
    }
    await admin.from("import_jobs").update({ status: "done", report, finished_at: new Date().toISOString() }).eq("id", job_id);
    await admin.from("notifications").insert({
      user_id: user.id,
      type: "import_done",
      payload: { matched: report.matched, watch_events: report.watchEvents, unmatched: report.unmatched.length },
    });
    // best-effort cleanup of the uploaded zip
    await admin.storage.from("imports").remove([path]);
  })();

  // Respond immediately; run the import in the background where supported,
  // else await inline. (waitUntil() returns void — must branch explicitly.)
  // deno-lint-ignore no-explicit-any
  const edge = (globalThis as any).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
  else await work;

  return json({ job_id, shows: shows.length, status: "running" });
});
