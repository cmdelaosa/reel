import { Bell, Check, Mail, RotateCcw, Sparkles, X } from "lucide-react";
import {
  useSettings, setSetting, resetSettings,
  type AccentName, type DensityName, type ThemeName,
} from "@/lib/settings";
import {
  NOTIFICATION_TYPES, prefFor, useNotificationPrefs, useSetPref,
} from "@/lib/notificationPrefs";

/* Settings sheet — the prototype's DesignLab stripped to production scope:
   theme (system/dark/oled/light), accent, density. Look/concept/radius were
   prototype-only experiments. */

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
    <div className="segmented" style={{ flexWrap: "wrap" }}>
      {options.map((o) => (
        <div key={o.v} className={`seg ${value === o.v ? "seg-active" : ""}`} onClick={() => onPick(o.v)}>
          {o.label}
        </div>
      ))}
    </div>
  );
}

const ACCENTS: { v: AccentName; c: string }[] = [
  { v: "coral", c: "#ff6a5c" },
  { v: "violet", c: "#8b7cff" },
  { v: "emerald", c: "#35d39a" },
  { v: "amber", c: "#fbbf3c" },
];

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
    <Row label="Notifications">
      <div className="flex flex-col gap-3">
        {NOTIFICATION_TYPES.map((t) => {
          const p = prefFor(prefs, t.type);
          return (
            <div key={t.type} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div style={{ fontSize: 13.5, fontWeight: 650 }}>{t.label}</div>
                <div className="mute truncate" style={{ fontSize: 12 }}>{t.sub}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Toggle on={p.inapp} icon={Bell} label="App" onClick={() => setPref.mutate({ type: t.type, pref: { ...p, inapp: !p.inapp } })} />
                <Toggle on={p.email} icon={Mail} label="Email" onClick={() => setPref.mutate({ type: t.type, pref: { ...p, email: !p.email } })} />
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

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        className="sheet fixed z-[70] card flex flex-col"
        style={{ right: 0, top: 0, height: "100vh", width: "min(380px, 92vw)", borderRadius: 0, borderLeft: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 800, fontSize: 16 }}>Settings</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-7">
          <Row label="Theme">
            <Seg<ThemeName>
              value={settings.theme}
              onPick={(v) => setSetting("theme", v)}
              options={[
                { v: "system", label: "System" },
                { v: "dark", label: "Dark" },
                { v: "oled", label: "OLED black" },
                { v: "light", label: "Light" },
              ]}
            />
          </Row>

          <Row label="Accent color">
            <div className="flex gap-3">
              {ACCENTS.map((a) => (
                <button
                  key={a.v}
                  onClick={() => setSetting("accent", a.v)}
                  className="grid place-items-center"
                  style={{
                    width: 46, height: 46, borderRadius: "var(--r)", background: a.c, cursor: "pointer",
                    border: settings.accent === a.v ? "3px solid var(--text)" : "3px solid transparent",
                    boxShadow: "0 6px 16px -8px rgba(0,0,0,.5)",
                  }}
                >
                  {settings.accent === a.v && <Check size={20} color="#fff" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Density">
            <Seg<DensityName>
              value={settings.density}
              onPick={(v) => setSetting("density", v)}
              options={[
                { v: "comfortable", label: "Comfortable" },
                { v: "compact", label: "Compact" },
              ]}
            />
          </Row>

          <NotificationsSection />

          <div className="card p-4 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Live preview</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btn-accent btn-sm">Primary</button>
              <button className="btn btn-outline btn-sm">Outline</button>
              <span className="chip chip-active">Active chip</span>
              <span className="badge badge-accent">Badge</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-ghost flex-1" onClick={resetSettings}><RotateCcw size={15} />Reset</button>
          <button className="btn btn-accent flex-1" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}
