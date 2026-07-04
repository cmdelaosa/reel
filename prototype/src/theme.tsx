import { createContext, useContext, useEffect, useState } from "react";

export type ConceptName = "app" | "marquee";
export type LookName = "classic" | "glass" | "fable" | "neo";
export type ThemeName = "dark" | "oled" | "light";
export type AccentName = "coral" | "violet" | "emerald" | "amber";
export type RadiusName = "sharp" | "rounded" | "soft";
export type DensityName = "comfortable" | "compact";

export interface Settings {
  concept: ConceptName;
  look: LookName;
  theme: ThemeName;
  accent: AccentName;
  radius: RadiusName;
  density: DensityName;
}

const DEFAULTS: Settings = {
  concept: "app",
  look: "glass",
  theme: "dark",
  accent: "coral",
  radius: "rounded",
  density: "comfortable",
};

const KEY = "tvt.design";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      // migrate the retired "flow" concept to its successor
      if ((s.concept as string) === "flow") s.concept = "marquee";
      return s;
    }
  } catch {}
  return DEFAULTS;
}

function apply(s: Settings) {
  const el = document.documentElement;
  el.dataset.concept = s.concept;
  el.dataset.look = s.look;
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
  el.dataset.radius = s.radius;
  el.dataset.density = s.density;
}

interface Ctx {
  settings: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  reset: () => void;
}

const ThemeCtx = createContext<Ctx>(null as unknown as Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    apply(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  const set: Ctx["set"] = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const reset = () => setSettings(DEFAULTS);

  return <ThemeCtx.Provider value={{ settings, set, reset }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
