import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { useContinueImport, useLatestImportJob, useStartImport } from "@/lib/import";
import { qk } from "@/lib/queryKeys";

/* Import from TV Time — drop zone → job status (polled) → report. */

export default function ImportPage() {
  const { data: job } = useLatestImportJob();
  const start = useStartImport();
  const continueImport = useContinueImport();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Drive a chunked import to completion: a large import walls after ~4min and
  // the server leaves the job running+waiting with a resume cursor; re-invoke to
  // continue. Also re-invoke if a pass appears to have died mid-flight (no
  // progress for a while), or if the job is stuck at pending — the zip uploads
  // before the invoke, so a pending job whose invoke never reached the server
  // just needs a kick. invoke() is idempotent, so a spurious call is safe.
  const stall = useRef<{ done: number; at: number } | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "pending")) { stall.current = null; return; }
    const r = job.report as Record<string, unknown>;
    const done = typeof r.done === "number" ? r.done : 0;
    const waiting = r.waiting === true;
    const now = Date.now();
    if (!stall.current || stall.current.done !== done) stall.current = { done, at: now };
    const stalledMs = now - stall.current.at;
    const stallLimit = job.status === "pending" ? 15_000 : 60_000;
    if (!continueImport.isPending && (waiting || stalledMs > stallLimit)) {
      stall.current = { done, at: now }; // debounce
      continueImport.mutate(job.id);
    }
  }, [job, continueImport]);

  const busy = start.isPending || job?.status === "pending" || job?.status === "running";

  const submit = (file: File) => {
    start.mutate(file, {
      onSuccess: () => {
        // library refreshes as the import writes
        qc.invalidateQueries({ queryKey: qk.library });
      },
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) submit(file);
  };

  const report = (job?.report ?? {}) as Record<string, number | string>;

  return (
    <div className="screen mq-page" style={{ maxWidth: 640, marginInline: "auto" }}>
      <header className="mq-header">
        <h1 className="mq-h1">Import from TV Time</h1>
        <p className="dim mq-sub">
          Upload your TV Time GDPR export (a <code>.zip</code>). We'll match your shows to TMDB and
          bring over your follows and watch history. Ratings aren't included.
        </p>
      </header>

      <button
        type="button"
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={busy}
        className="card"
        style={{
          padding: "40px 24px", display: "grid", placeItems: "center", gap: 10, cursor: busy ? "default" : "pointer",
          borderStyle: "dashed", borderColor: dragging ? "var(--accent)" : "var(--border-strong)", textAlign: "center",
        }}
      >
        <Upload size={28} style={{ color: "var(--accent)" }} />
        <div style={{ fontWeight: 700 }}>{busy ? "Importing…" : "Drop your export zip here"}</div>
        <div className="mute" style={{ fontSize: 13 }}>or click to choose · max 25MB</div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => e.target.files?.[0] && submit(e.target.files[0])}
        />
      </button>

      {start.error && (
        <p role="alert" style={{ color: "#e5484d", fontSize: 13.5 }}>{(start.error as Error).message}</p>
      )}

      {job && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="flex items-center gap-2.5">
            {job.status === "done" && <CheckCircle2 size={20} style={{ color: "var(--accent)" }} />}
            {job.status === "error" && <XCircle size={20} style={{ color: "#e5484d" }} />}
            {(job.status === "pending" || job.status === "running") && <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />}
            <div style={{ fontWeight: 750 }}>
              {job.status === "done" && "Import complete"}
              {job.status === "error" && "Import failed"}
              {job.status === "pending" && "Queued…"}
              {job.status === "running" && `Importing… ${report.done ?? 0} / ${report.total ?? "?"} shows`}
            </div>
          </div>

          {job.status === "error" && (
            <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{String(report.error ?? "Unknown error")}</p>
          )}

          {job.status === "done" && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              {[
                { label: "Shows matched", value: report.matched },
                { label: "Episodes marked", value: report.watchEvents ?? report.watch_events },
                { label: "Couldn't match", value: report.unmatched ?? (Array.isArray(report.unmatched) ? (report.unmatched as unknown[]).length : 0) },
              ].map((s) => (
                <div key={s.label} className="surface-2" style={{ borderRadius: "var(--r)", padding: 14 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{String(s.value ?? 0)}</div>
                  <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {job.status === "done" && Array.isArray((job.report as Record<string, unknown>).unmatched) && (
            <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
              Unmatched shows can be added by hand — search for them with ⌘K.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
