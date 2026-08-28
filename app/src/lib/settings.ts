import { useSyncExternalStore } from "react";
import { deviceCountry, isCountryCode } from "@/lib/countries";
import { DEFAULT_START_MEDIUM, resolveStartMedium } from "@/domain/startPage";
import type { Medium } from "@/domain/mediumCopy";

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
  /** ISO 3166-1 alpha-2 — always one of lib/countries' COUNTRIES, never
   *  absent. It decides both the timezone air times render in and the country
   *  Reel asks TMDB for streaming providers (see lib/region.ts). There is no
   *  "follow my device" value: a zone doesn't name a country, and providers
   *  need a country. The device only seeds the initial guess. */
  country: string;
  /** Ids de proveedor de TMDB de las plataformas a las que estás suscrito, en
   *  el país de arriba. Vacío = no lo has dicho, que es el estado de salida y
   *  un estado válido para siempre: sin lista, "Nuevo en streaming" enseña todo
   *  lo que entra en suscripción en tu país en vez de nada.
   *
   *  Vive SOLO aquí, no en `profiles`, al revés que el país. El país subió al
   *  servidor porque un cron lo necesita para decidir a quién avisa; esto no lo
   *  lee nadie salvo la pantalla que lo pinta, y una lista de a qué te has
   *  suscrito es de las cosas que es mejor no guardar en un sitio donde no hace
   *  falta. Si algún día un aviso dice "ya está en TU Netflix", entonces sube. */
  services: number[];
  /** Con qué modo abre la app: series, cine o juegos. La ruta "/" redirige a
   *  la portada de ese modo (domain/startPage), así que esto es lo primero que
   *  se ve al entrar por el icono de la pantalla de inicio o por el marcador.
   *
   *  Se guarda el MODO y no la ruta: la ruta la decide startPage a partir de
   *  la tabla que ya existe, y así renombrar una portada no deja a nadie
   *  guardado apuntando a una URL que ya no está. */
  startMedium: Medium;
}

const BASE: Omit<Settings, "country"> = {
  theme: "dark",
  accent: "coral",
  density: "comfortable",
  language: "en",
  services: [],
  startMedium: DEFAULT_START_MEDIUM,
};

const defaults = (): Settings => ({ ...BASE, country: deviceCountry() });

const KEY = "reel.settings";

// typeof, not `in`: jsdom declares matchMedia without implementing it, so the
// key-presence check passed and the call threw on import.
const lightQuery: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

/** The country exactly as storage held it, so init can tell a migration from a
 *  no-op and only write when something actually changed. */
let rawStoredCountry: unknown;

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = { ...base, ...JSON.parse(raw) } as Settings;
      rawStoredCountry = stored.country;
      // Everyone stored before this shipped carries country:"auto", which no
      // longer means anything — resolve it once from the device and keep it.
      // Same path catches a hand-edited or retired code.
      if (!isCountryCode(stored.country)) stored.country = base.country;
      // Lo mismo para las plataformas: llega de localStorage, o sea de fuera, y
      // acaba dentro de una URL que se le manda a TMDB. Un `services` que no sea
      // una lista de números —storage editado a mano, o de una versión anterior
      // que guardaba otra cosa— se descarta entero en vez de propagarse.
      if (!Array.isArray(stored.services) || stored.services.some((s) => !Number.isInteger(s))) {
        stored.services = [];
      }
      // Y lo mismo para el modo con el que abre la app: sale de storage y
      // decide un navigate(). La lista de tres vive en domain/startPage, con
      // sus pruebas — y se come de paso lo que guardaba la primera versión de
      // este ajuste, que era una ruta.
      stored.startMedium = resolveStartMedium(stored.startMedium);
      return stored;
    }
  } catch {
    /* corrupt storage → defaults */
  }
  return base;
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

// Pin the resolved country on the way in. Without this the guess would be
// re-made every launch, which is the "follow my device" behaviour this setting
// deliberately dropped — and would move a traveller's providers mid-trip.
// Runs down here, not beside load(): persist() closes over `listeners`, and
// calling it any earlier is a temporal-dead-zone crash at boot for exactly the
// viewers who need the migration.
if (settings.country !== rawStoredCountry) persist();

export function getSettings(): Settings {
  return settings;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings = { ...settings, [k]: v };
  persist();
}

export function resetSettings() {
  settings = defaults();
  persist();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
