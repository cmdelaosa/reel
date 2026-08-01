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
import { unzipCsvs, parseShows, parseWatches, parseArchived, parseFollowedAt, runImport, NotATvTimeExport, type ImportReport } from "../../../scripts/tvtime-import/lib.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });

const WALL_MS = 240_000;
// Hosted edge isolates hit a CPU-time limit (~120 heavy shows) well before the
// wall above, dying with "CPU Time exceeded" mid-pass. Cap each pass so it hands
// off cleanly (waiting:true) at a boundary, and the next isolate resumes with a
// fresh CPU budget — the client re-invokes on waiting:true within a poll tick.
const MAX_PER_PASS = 60;

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

  // The uploaded object must live under the caller's own folder — and reject any
  // `..` so a crafted path like `<uid>/../<other>/x` can't escape it under the
  // service-role read below.
  if (!String(path).startsWith(`${user.id}/`) || String(path).includes("..")) {
    return json({ error: "forbidden path" }, 403);
  }

  // The job row must belong to the caller (service-role writes bypass RLS, so
  // verify ownership before touching it — otherwise a caller could overwrite
  // another user's import_jobs row).
  const { data: jobRow } = await admin.from("import_jobs").select("user_id, status").eq("id", job_id).maybeSingle();
  if (!jobRow || jobRow.user_id !== user.id) return json({ error: "job not found" }, 404);
  // A finished job is terminal. A late duplicate invoke — the client backstop,
  // or a self-invoke still in flight when the final pass completed and deleted
  // the zip — must not re-process it or, worse, flip a successful import to
  // "error" on the now-missing upload. No-op.
  if (jobRow.status === "done") return json({ job_id, status: "done" });

  // `.neq("status","done")` on every terminal-error write: if a concurrent
  // invoke completes the job between here and the write, don't clobber it.
  const fail = async (message: string, status = 400) => {
    await admin.from("import_jobs").update({ status: "error", report: { error: message }, finished_at: new Date().toISOString() }).eq("id", job_id).neq("status", "done");
    return json({ error: message }, status);
  };

  const { data: blob, error: dlErr } = await admin.storage.from("imports").download(path);
  if (dlErr || !blob) return fail(`could not read upload: ${dlErr?.message ?? "missing"}`);

  let shows, watches, archived, followed;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const csvs = unzipCsvs(bytes);
    shows = parseShows(csvs);
    watches = parseWatches(csvs); // exact per-episode history; empty map → counter fallback
    archived = parseArchived(csvs); // TV Time "archived" → stopped
    followed = parseFollowedAt(csvs); // real "followed since" date → backdates added_at
  } catch (err) {
    return fail(err instanceof NotATvTimeExport ? err.message : `unreadable zip: ${String(err)}`);
  }
  if (shows.length === 0) return fail("no shows found in export");

  // Resume cursor: the client re-invokes while status is running+waiting to
  // continue a walled import. nextIndex/counts persist on the job's report.
  const { data: priorJob } = await admin.from("import_jobs").select("report").eq("id", job_id).maybeSingle();
  const priorReport = (priorJob?.report ?? {}) as Record<string, unknown>;
  const startIndex = typeof priorReport.nextIndex === "number" ? priorReport.nextIndex : 0;
  // Seed cumulative counts only when actually resuming (a full report was saved
  // at the wall); a first pass carries only { total, done } and must start fresh.
  const seed = startIndex > 0 && Array.isArray(priorReport.unmatched) ? (priorReport as unknown as ImportReport) : undefined;

  await admin.from("import_jobs")
    .update({ status: "running", report: { ...(seed ?? {}), total: shows.length, done: startIndex, waiting: false } })
    .eq("id", job_id);

  const deadline = Date.now() + WALL_MS;
  const work = (async () => {
    try {
      const report = await runImport(
        admin, tmdbKey, user.id, shows, watches, archived, followed,
        (done, r) => {
          // Throttled progress; persist the FULL cumulative report so a resume
          // after a mid-pass isolate death seeds from it (the seed check above
          // needs `unmatched` — partial writes here used to reset the counters).
          // Fire-and-forget — never let a blip reject the isolate.
          if (done % 5 === 0) {
            admin.from("import_jobs")
              .update({ report: { ...r, total: shows.length, done, nextIndex: done } })
              .eq("id", job_id)
              .then(() => {}, () => {});
          }
        },
        startIndex, deadline, seed, MAX_PER_PASS,
      );

      if (!report.complete) {
        // Hit the wall. If a whole pass made zero forward progress, don't spin
        // forever — fail cleanly (one show can't fit the budget).
        if (report.nextIndex <= startIndex) {
          await admin.from("import_jobs")
            .update({ status: "error", report: { error: `import stalled at show ${startIndex + 1} of ${shows.length}` }, finished_at: new Date().toISOString() })
            .eq("id", job_id).neq("status", "done");
          return;
        }
        // Persist cursor + full report and flag as waiting.
        await admin.from("import_jobs")
          .update({ status: "running", report: { ...report, total: shows.length, done: report.nextIndex, waiting: true } })
          .eq("id", job_id);
        // Self-continue server-side so completion doesn't hinge on the client
        // tab staying open: re-invoke the next chunk with the caller's JWT. Each
        // pass fires exactly one continuation (a linear chain, no fan-out), and
        // the zero-progress guard above terminates it. Best-effort — the client
        // stall kick remains a fallback if this fetch is dropped.
        const auth = req.headers.get("Authorization");
        if (auth) {
          await fetch(`${url}/functions/v1/importer`, {
            method: "POST",
            headers: { Authorization: auth, "content-type": "application/json" },
            body: JSON.stringify({ job_id, path }),
          }).catch(() => {});
        }
        return;
      }

      await admin.from("import_jobs")
        .update({ status: "done", report: { ...report, total: shows.length, done: shows.length, waiting: false }, finished_at: new Date().toISOString() })
        .eq("id", job_id);
      // Honour the Settings toggle, absent row = on (same default as the
      // reaction/friend-request triggers). This one used to notify regardless.
      const { data: pref } = await admin.from("notification_prefs")
        .select("inapp").eq("user_id", user.id).eq("type", "import_done").maybeSingle();
      if (pref?.inapp !== false) {
        await admin.from("notifications").insert({
          user_id: user.id,
          type: "import_done",
          payload: { matched: report.matched, watch_events: report.watchEvents, unmatched: report.unmatched.length },
        });
      }
      // best-effort cleanup of the uploaded zip
      await admin.storage.from("imports").remove([path]);
    } catch (e) {
      // ANY failure now reaches a terminal state (was: job stuck 'running' forever).
      await admin.from("import_jobs")
        .update({ status: "error", report: { error: (e as Error)?.message ?? String(e) }, finished_at: new Date().toISOString() })
        .eq("id", job_id).neq("status", "done");
    }
  })();

  // Respond immediately; run the import in the background where supported,
  // else await inline. (waitUntil() returns void — must branch explicitly.)
  // deno-lint-ignore no-explicit-any
  const edge = (globalThis as any).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
  else await work;

  return json({ job_id, shows: shows.length, status: "running" });
});
