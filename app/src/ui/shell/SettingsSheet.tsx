import { useEffect } from "react";
import { useNavigate } from "react-router";
// Sliders, not lucide's Settings gear: this has to match the shell button that
// opens the sheet, or the icon changes under you on click.
import { Bell, Download, Mail, RotateCcw, Sliders as SettingsIcon, Upload, X } from "lucide-react";
import { useFocusTrap } from "@/ui/useFocusTrap";
import {
  useSettings, setSetting, resetSettings,
  type LanguageName, type ThemeName,
} from "@/lib/settings";
import {
  NOTIFICATION_TYPES, prefFor, useNotificationPrefs, useSetPref,
} from "@/lib/notificationPrefs";
import { t } from "@/lib/i18n";

/* Settings sheet — the prototype's DesignLab stripped to production scope:
   theme (system/dark/oled/light) + notification prefs + data actions. */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="eyebrow">{label}</div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onPick }: {
  value: T;
  options: { v: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="segmented wrap">
      {options.map((o) => (
        <div key={o.v} className={`seg ${value === o.v ? "seg-active" : ""}`} onClick={() => onPick(o.v)}>
          {o.label}
        </div>
      ))}
    </div>
  );
}

function Toggle({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof Bell; label: string }) {
  return (
    <button
      className={`chip ${on ? "chip-active" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      title={`${label}: ${on ? "on" : "off"}`}
    >
      <Icon size={13} />{label}
    </button>
  );
}

function NotificationsSection() {
  const { data: prefs } = useNotificationPrefs();
  const setPref = useSetPref();
  return (
    <Row label={t("Notifications")}>
      <div className="flex flex-col gap-3">
        {NOTIFICATION_TYPES.map((n) => {
          const p = prefFor(prefs, n.type);
          return (
            <div key={n.type} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div style={{ fontSize: 13.5, fontWeight: 650 }}>{t(n.label)}</div>
                <div className="mute truncate" style={{ fontSize: 12 }}>{t(n.sub)}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Toggle on={p.inapp} icon={Bell} label={t("App")} onClick={() => setPref.mutate({ type: n.type, pref: { ...p, inapp: !p.inapp } })} />
                <Toggle on={p.email} icon={Mail} label={t("Email")} onClick={() => setPref.mutate({ type: n.type, pref: { ...p, email: !p.email } })} />
              </div>
            </div>
          );
        })}
      </div>
    </Row>
  );
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const trapRef = useFocusTrap<HTMLDivElement>();
  const go = (path: string) => { onClose(); navigate(path); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Settings")}
        tabIndex={-1}
        className="sheet fixed z-[70] card flex flex-col"
        style={{ right: 0, top: 0, height: "100vh", width: "min(380px, 92vw)", borderRadius: 0, borderLeft: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <SettingsIcon size={18} style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 800, fontSize: 16 }}>{t("Settings")}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-7">
          <Row label={t("Theme")}>
            <Seg<ThemeName>
              value={settings.theme}
              onPick={(v) => setSetting("theme", v)}
              options={[
                { v: "system", label: t("System") },
                { v: "dark", label: t("Dark") },
                { v: "oled", label: t("OLED black") },
                { v: "light", label: t("Light") },
              ]}
            />
          </Row>

          <Row label={t("Language")}>
            <Seg<LanguageName>
              value={settings.language}
              onPick={(v) => {
                if (v === settings.language) return;
                setSetting("language", v);
                // The language is read once per render with no subscription
                // plumbing (see lib/i18n.ts) — a reload applies it everywhere,
                // dates and search language included.
                window.location.reload();
              }}
              options={[
                { v: "en", label: "English" },
                { v: "es", label: "Español" },
              ]}
            />
          </Row>

          <NotificationsSection />

          <Row label={t("Your data")}>
            <div className="flex flex-col gap-2">
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={() => go("/import")}>
                <Upload size={16} />{t("Import from TV Time")}
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={() => go("/export")}>
                <Download size={16} />{t("Export my data")}
              </button>
            </div>
          </Row>
        </div>

        <div className="px-5 py-4 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-ghost flex-1" onClick={resetSettings}><RotateCcw size={15} />{t("Reset")}</button>
          <button className="btn btn-accent flex-1" onClick={onClose}>{t("Done")}</button>
        </div>
      </div>
    </>
  );
}
