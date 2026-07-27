import { setSetting, useSettings, type LanguageName } from "@/lib/settings";

const LANGS: { code: LanguageName; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];

/**
 * Public EN/ES language switch for the signed-out pages (landing, legal) — the
 * in-app language picker lives behind the login in Settings. Writes the choice
 * to the same persisted setting and reloads: t() reads the language once per
 * render, and the static marketing/legal sections don't re-run it on their own,
 * so a reload is the reliable way to repaint the whole page in the new language
 * (this is how the Settings sheet already switches language).
 */
export function LangToggle() {
  const { language } = useSettings();

  const pick = (code: LanguageName) => {
    if (code === language) return;
    setSetting("language", code);
    window.location.reload();
  };

  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
      }}
    >
      {LANGS.map(({ code, label }) => {
        const active = code === language;
        return (
          <button
            key={code}
            type="button"
            onClick={() => pick(code)}
            aria-pressed={active}
            style={{
              border: 0,
              cursor: active ? "default" : "pointer",
              borderRadius: 999,
              padding: "3px 9px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".02em",
              fontFamily: "var(--font)",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--on-accent)" : "var(--text-mute)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
