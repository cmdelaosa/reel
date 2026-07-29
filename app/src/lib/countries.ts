/* The country the viewer watches from — the one setting two features hang off.
   Deliberately import-free: lib/settings reads it during module init and
   lib/region layers the localized names on top, so anything imported here
   would be a cycle through the settings store.

   Every entry is two promises at once now: that its single timezone is right
   for the whole country (air times), and that its ISO 3166-1 alpha-2 code is
   the right key into TMDB's watch/providers (where to watch). The second is
   true for any country; the first is what keeps this list short. Spain,
   Germany and Switzerland all sit on CET/CEST and shift together.

   Adding a country with several timezones means breaking the country setting
   back into two — a region for providers and a zone for air times. Until then
   this list only grows with single-zone countries. */

export interface Country {
  /** ISO 3166-1 alpha-2 — the key TMDB's watch/providers is keyed by. */
  code: string;
  /** IANA zone of the country's main population centre. */
  tz: string;
  en: string;
  es: string;
}

export const COUNTRIES: Country[] = [
  { code: "ES", tz: "Europe/Madrid", en: "Spain", es: "España" },
  { code: "DE", tz: "Europe/Berlin", en: "Germany", es: "Alemania" },
  { code: "CH", tz: "Europe/Zurich", en: "Switzerland", es: "Suiza" },
];

/** Used when the device's zone maps to no country we offer. A wrong guess the
 *  viewer can see and change in Settings beats an empty one that silently
 *  hides every provider logo in the app. */
export const FALLBACK_COUNTRY = "ES";

/* Zones that resolve to a country beyond its main one — the Canaries run an
   hour behind the peninsula but are unambiguously Spain, and Büsingen is a
   German exclave inside Switzerland. Air times are a little off for a Canarian
   who leaves the setting alone; the providers are exactly right, and Settings
   is one tap away. */
const EXTRA_ZONES: Record<string, string> = {
  "Atlantic/Canary": "ES",
  "Africa/Ceuta": "ES",
  "Europe/Busingen": "DE",
};

export const isCountryCode = (v: unknown): v is string =>
  typeof v === "string" && COUNTRIES.some((c) => c.code === v);

/** Best guess at the viewer's country from an IANA zone, or null. */
export function countryFromTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  return COUNTRIES.find((c) => c.tz === tz)?.code ?? EXTRA_ZONES[tz] ?? null;
}

/** The device's own IANA zone — the seed for the initial country guess. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** The country to start a viewer on before they've chosen one. */
export const deviceCountry = (): string =>
  countryFromTimeZone(deviceTimeZone()) ?? FALLBACK_COUNTRY;
