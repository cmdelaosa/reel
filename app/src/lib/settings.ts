import { useSyncExternalStore } from "react";

/* User-facing appearance settings, persisted to localStorage and applied to
   the <html> dataset. Ported from prototype/src/theme.tsx minus concept/look:
   production ships only the Marquee shell with data-look="glass", hardcoded
   in index.html. */

export type ThemeName = "dark" | "oled" | "light";
export type AccentName = "coral" | "violet" | "emerald" | "amber";

export interface Settings {
  theme: ThemeName;
  accent: AccentName;
}

const DEFAULTS: Settings = {
  theme: "dark",
  accent: "coral",
};

const KEY = "reel.settings";

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
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
}

let settings = load();
apply(settings);

const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return settings;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings = { ...settings, [k]: v };
  apply(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable → session-only */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
