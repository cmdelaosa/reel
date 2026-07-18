import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { useContinueImport, useLatestImportJob, useStartImport } from "@/lib/import";
import { isEs, t as tr } from "@/lib/i18n";
import { qk } from "@/lib/queryKeys";

/* Import from TV Time — drop zone → job status (polled) → report. */

export default function ImportPage() {
  const { data: job } = useLatestImportJob();
  const start = useStartImport();
  const continueImport = useContinueImport();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Backstop for a chunked import. The server now self-continues each chunk
  // (waiting:true → it re-invokes the next pass), so the happy path needs no
  // client kick — we only step in when progress stalls: a pass died mid-flight
  // before it could hand off, a self-invoke was dropped, or the job is stuck at
  // pending because its very first invoke never reached the server (the zip
  // uploads before that invoke). invoke() is idempotent, so a spurious call is
  // safe; kicking only on stall (not on every waiting:true) avoids racing the
  // server's own continuation and fanning out duplicate passes.
  const stall = useRef<{ done: number; at: number } | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "pending")) { stall.current = null; return; }
    const r = job.report as Record<string, unknown>;
    const done = typeof r.done === "number" ? r.done : 0;
    const now = Date.now();
    if (!stall.current || stall.current.done !== done) stall.current = { done, at: now };
    const stalledMs = now - stall.current.at;
    const stallLimit = job.status === "pending" ? 15_000 : 90_000;
    if (!continueImport.isPending && stalledMs > stallLimit) {
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
  const raw = (job?.report ?? {}) as Record<string, unknown>;
  const unmatched = (Array.isArray(raw.unmatched) ? (raw.unmatched as { name?: string }[]) : [])
    .map((u) => u.name?.trim() || "(unnamed)");

  return (
    <div className="screen mq-page" style={{ maxWidth: 640, marginInline: "auto" }}>
      <header className="mq-header">
        <h1 className="mq-h1">{tr("Import from TV Time")}</h1>
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
        <div style={{ fontWeight: 700 }}>{busy ? (isEs() ? "Importando…" : "Importing…") : (isEs() ? "Suelta aquí tu zip" : "Drop your export zip here")}</div>
        <div className="mute" style={{ fontSize: 13 }}>{isEs() ? "o haz clic para elegirlo · máx. 25MB" : "or click to choose · max 25MB"}</div>
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
              {job.status === "done" && (isEs() ? "Importación completada" : "Import complete")}
              {job.status === "error" && (isEs() ? "La importación falló" : "Import failed")}
              {job.status === "pending" && (isEs() ? "En cola…" : "Queued…")}
              {job.status === "running" && (isEs()
                ? `Importando… ${report.done ?? 0} / ${report.total ?? "?"} series`
                : `Importing… ${report.done ?? 0} / ${report.total ?? "?"} shows`)}
            </div>
          </div>

          {job.status === "error" && (
            <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{String(report.error ?? "Unknown error")}</p>
          )}

          {job.status === "done" && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              {[
                { label: isEs() ? "Series encontradas" : "Shows matched", value: report.matched },
                { label: isEs() ? "Episodios marcados" : "Episodes marked", value: report.watchEvents ?? report.watch_events },
                { label: isEs() ? "Sin coincidencia" : "Couldn't match", value: unmatched.length },
              ].map((s) => (
                <div key={s.label} className="surface-2" style={{ borderRadius: "var(--r)", padding: 14 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{String(s.value ?? 0)}</div>
                  <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {job.status === "done" && unmatched.length > 0 && (
            <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
              {isEs()
                ? <>Sin coincidencia: {unmatched.join(", ")} — añádelas a mano con ⌘K.</>
                : <>Couldn't match: {unmatched.join(", ")} — add them by hand with ⌘K.</>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
