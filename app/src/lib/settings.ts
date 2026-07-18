import { useSyncExternalStore } from "react";

/* User-facing appearance settings, persisted to localStorage and applied to
   the <html> dataset. Ported from prototype/src/theme.tsx minus concept/look:
   production ships only the Marquee shell with data-look="glass", hardcoded
   in index.html. "system" follows prefers-color-scheme (dark/light). */

export type ThemeName = "system" | "dark" | "oled" | "light";
export type AccentName = "coral" | "violet" | "emerald" | "amber";
export type DensityName = "comfortable" | "compact";
export type LanguageName = "en" | "es";

export interface Settings {
  theme: ThemeName;
  accent: AccentName;
  density: DensityName;
  language: LanguageName;
}

const DEFAULTS: Settings = {
  theme: "dark",
  accent: "coral",
  density: "comfortable",
  language: "en",
};

const KEY = "reel.settings";

const lightQuery: MediaQueryList | null =
  typeof window !== "undefined" && "matchMedia" in window
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* corrupt storage → defaults */
  }
  return DEFAULTS;
}

function apply(s: Settings) {
  const el = document.documentElement;
  el.dataset.theme =
    s.theme === "system" ? (lightQuery?.matches ? "light" : "dark") : s.theme;
  el.dataset.accent = s.accent;
  el.dataset.density = s.density;
  el.lang = s.language;
}

let settings = load();
apply(settings);

// Follow OS theme changes while in "system".
lightQuery?.addEventListener("change", () => {
  if (settings.theme === "system") apply(settings);
});

const listeners = new Set<() => void>();

function persist() {
  apply(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable → session-only */
  }
  listeners.forEach((fn) => fn());
}

export function getSettings(): Settings {
  return settings;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings = { ...settings, [k]: v };
  persist();
}

export function resetSettings() {
  settings = DEFAULTS;
  persist();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
