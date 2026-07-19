import { useState } from "react";
import { Download, FileJson, Loader2, Table2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { t as tr } from "@/lib/i18n";

/* Export my data — downloads a zip (profile.json, library.json,
   watch_events.csv, ratings.csv) from the export edge function. */

export default function ExportPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reel-export.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen mq-page" style={{ maxWidth: 640, marginInline: "auto" }}>
      <h1 className="sr-only">{tr("Export my data")}</h1>

      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="flex flex-col gap-2.5">
          {[
            { icon: FileJson, name: "profile.json", desc: tr("Your profile") },
            { icon: FileJson, name: "library.json", desc: tr("Shows you follow") },
            { icon: Table2, name: "watch_events.csv", desc: tr("Every episode you've marked watched") },
            { icon: Table2, name: "ratings.csv", desc: tr("Your show ratings") },
          ].map((f) => (
            <div key={f.name} className="flex items-center gap-3">
              <f.icon size={18} className="mute" />
              <div className="min-w-0">
                <div style={{ fontSize: 13.5, fontWeight: 650 }}>{f.name}</div>
                <div className="mute" style={{ fontSize: 12 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-accent" style={{ alignSelf: "flex-start" }} onClick={download} disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" />{tr("Preparing…")}</> : <><Download size={16} />{tr("Download my data")}</>}
        </button>
        {error && <p role="alert" style={{ color: "#e5484d", fontSize: 13 }}>{error}</p>}
      </div>
    </div>
  );
}
