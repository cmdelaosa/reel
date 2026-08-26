import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
// Sliders, not lucide's Settings gear: this has to match the shell button that
// opens the sheet, or the icon changes under you on click.
import { Bell, Check, ChevronDown, Download, Mail, RotateCcw, Sliders as SettingsIcon, Upload, X } from "lucide-react";
import { useFocusTrap } from "@/ui/useFocusTrap";
import {
  useSettings, setSetting, resetSettings,
  type LanguageName, type ThemeName,
} from "@/lib/settings";
import {
  NOTIFICATION_TYPES, prefFor, useNotificationPrefs, useSetPref,
} from "@/lib/notificationPrefs";
import { COUNTRIES, countryName } from "@/lib/region";
import { useProviderOptions } from "@/lib/movies";
import { tmdbImg } from "@/lib/tmdb";
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
                {/* Sin truncate. Los dos chips de la derecha son shrink-0, así
                    que se llevaban todo el ancho y esta línea se quedaba con
                    131px de los hasta 325 que pide en español: "Cuando una
                    película de tu lista llega al cine o a streaming" se veía
                    hasta "llega al…". Una descripción que hay que adivinar no
                    describe nada, y aquí sobra el alto: la hoja ya scrollea. */}
                <div className="mute" style={{ fontSize: 12 }}>{t(n.sub)}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Toggle on={p.inapp} icon={Bell} label={t("App")} onClick={() => setPref.mutate({ type: n.type, pref: { ...p, inapp: !p.inapp } })} />
                {/* Email only where a sender exists — see NOTIFICATION_TYPES. */}
                {n.channels.includes("email") && (
                  <Toggle on={p.email} icon={Mail} label={t("Email")} onClick={() => setPref.mutate({ type: n.type, pref: { ...p, email: !p.email } })} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Row>
  );
}

/* Tus plataformas. Solo afecta a un carril —"Nuevo en streaming" del modo
   cine—, y por eso su texto de ayuda dice exactamente eso en vez de prometer
   una personalización que no existe en el resto de la app.

   Sin nada marcado el carril NO se queda vacío: enseña todo lo que entra en
   suscripción en tu país. Marcar es estrechar, no encender, así que este ajuste
   nunca es un requisito para que algo funcione. */
function ServicesSection() {
  const { services } = useSettings();
  const { data: options = [], isLoading } = useProviderOptions(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  /* Dónde cabe el menú. Los demás .filter-menu de la app viven en barras de
     herramientas que no scrollean, así que les basta con colgar del disparador;
     este vive dentro del cuerpo de la hoja, que es `overflow-y: auto`, y ahí un
     absoluto se recorta contra el contenedor. Medido: con la fila cerca del
     fondo, el menú se salía 223px por abajo — dos tercios de las plataformas
     inalcanzables, sin nada que dijera que estaban ahí.

     Así que se mide el hueco antes de pintar: se limita el alto a lo que queda
     libre y, si abajo no caben ni 200px y arriba hay más sitio, se abre hacia
     arriba. */
  const [arriba, setArriba] = useState(false);
  const [altoMax, setAltoMax] = useState<number | undefined>();
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    /* El carril se busca por su comportamiento, no por su clase: preguntar por
       `.overflow-y-auto` ataría esto al nombre de una utilidad de Tailwind que
       nadie está obligado a conservar, y el día que cambiara la medida se haría
       contra el viewport sin que nada fallara — el menú volvería a recortarse y
       la cuenta seguiría dando números creíbles. */
    let carril: Element = document.documentElement;
    for (let el = ref.current.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") { carril = el; break; }
    }
    const c = carril.getBoundingClientRect();
    const t = ref.current.getBoundingClientRect();
    const hueco = { abajo: c.bottom - t.bottom - 12, arriba: t.top - c.top - 12 };
    const haciaArriba = hueco.abajo < 200 && hueco.arriba > hueco.abajo;
    setArriba(haciaArriba);
    setAltoMax(Math.max(140, Math.floor(haciaArriba ? hueco.arriba : hueco.abajo)));
  }, [open]);

  /* Mismo idioma de cierre que TabMenu y que el popover de Filtros: fuera o
     Escape. Es lo que hace que un desplegable se comporte como el resto.

     El `stopPropagation` no es adorno: la hoja de Ajustes escucha Escape en
     `window` para cerrarse entera, y sin cortar aquí una sola tecla cerraba el
     menú Y la hoja detrás. Escape cierra lo de encima, no todo. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!isLoading && options.length === 0) return null;
  const toggle = (id: number) =>
    setSetting("services", services.includes(id) ? services.filter((s) => s !== id) : [...services, id]);

  const picked = options.filter((p) => services.includes(p.id));
  const logoOf = (p: (typeof options)[number]) => tmdbImg(p.logo_path, "w92");
  /* Dos nombres y un contador para el resto. El contador es un número, así que
     no hay plural que traducir ni cadena que se alargue al cambiar de idioma —
     que es justo lo que rompía la fila de chips que había aquí. */
  const summary = picked.length > 0
    ? picked.slice(0, 2).map((p) => p.name).join(", ") + (picked.length > 2 ? ` +${picked.length - 2}` : "")
    /* Mientras el catálogo no ha llegado, `picked` está vacío aunque haya
       plataformas guardadas — y decir "Todas las plataformas" entonces no es
       callarse, es afirmar lo contrario de lo que pasa. Los puntos suspensivos
       no prometen nada y no hay que traducirlos. */
    : isLoading && services.length > 0 ? "…" : t("All platforms");

  return (
    <Row label={t("Your services")}>
      <div style={{ position: "relative" }} ref={ref}>
        <button
          className="field-select"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left" }}
        >
          <span className="flex items-center gap-2 min-w-0">
            {picked.length > 0 && (
              <span className="flex items-center gap-1 shrink-0">
                {picked.slice(0, 3).map((p) => {
                  const logo = logoOf(p);
                  return logo
                    ? <img key={p.id} src={logo} alt="" width={16} height={16} style={{ borderRadius: 4, objectFit: "cover" }} />
                    : null;
                })}
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDown size={15} className="shrink-0" />
        </button>
        {open && (
          <div
            className="filter-menu"
            role="menu"
            aria-label={t("Your services")}
            style={{
              right: 0, minWidth: 0, maxHeight: altoMax,
              ...(arriba ? { top: "auto", bottom: "calc(100% + 6px)" } : null),
            }}
          >
            {options.map((p) => {
              const on = services.includes(p.id);
              const logo = logoOf(p);
              return (
                <button
                  key={p.id}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className="filter-opt"
                  onClick={() => toggle(p.id)}
                >
                  {logo && <img src={logo} alt="" width={16} height={16} style={{ borderRadius: 4, objectFit: "cover", flex: "0 0 auto" }} />}
                  <span className="truncate">{p.name}</span>
                  {on && <Check size={14} className="filter-opt-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mute" style={{ fontSize: 12 }}>
        {t("Narrows \"New to stream\" in Movies to the platforms you pay for. Leave it empty to see everything new in your country.")}
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

          <Row label={t("Country")}>
            <select
              className="field-select"
              value={settings.country}
              onChange={(e) => {
                setSetting("country", e.target.value);
                // Air times are formatted through lib/region.ts on render and
                // providers are keyed by country in the query cache, neither
                // with subscription plumbing — a reload is what makes the new
                // country show up everywhere.
                window.location.reload();
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{countryName(c)}</option>
              ))}
            </select>
            <div className="mute" style={{ fontSize: 12 }}>
              {t("Sets where you can stream each show, and the timezone airing times are shown in.")}
            </div>
          </Row>

          <ServicesSection />

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
