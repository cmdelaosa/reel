// lib/locale, not lib/i18n: the latter also owns useEsNames and so imports the
// Supabase client, which would make this module (and its tests) unloadable
// without credentials in the environment.
import { dateLocale, isEs } from "@/lib/locale";
import { getSettings } from "@/lib/settings";

/* Region — the country the viewer watches from, and everything that hangs off
   it. Today that is the timezone air times are rendered in; the same ISO
   3166-1 alpha-2 code is what TMDB's watch/providers wants, so the "where can
   I watch this here" work can reuse it untouched.

   Timezones are the main population centre of each country, which is all a
   country-level picker can honestly promise: pick Spain from the Canaries and
   you get peninsular time. That is why "auto" is the default and wins by
   default — the device already knows the exact zone, including while
   travelling. The picker is an override for people who want their shows on
   their home country's clock regardless of where they are. */

export interface Country {
  /** ISO 3166-1 alpha-2 — also the key TMDB's watch/providers is keyed by. */
  code: string;
  /** IANA zone of the country's main population centre. */
  tz: string;
  en: string;
  es: string;
}

/* Deliberately short: the countries the people using Reel actually watch from.
   Add a row when someone needs one — every entry is a promise that its single
   timezone is right for the whole country, so a long speculative list is worse
   than a short accurate one. Spain, Germany and Switzerland all sit on
   CET/CEST and shift together, so today the picker only matters for someone
   travelling outside that band. */
export const COUNTRIES: Country[] = [
  { code: "ES", tz: "Europe/Madrid", en: "Spain", es: "España" },
  { code: "DE", tz: "Europe/Berlin", en: "Germany", es: "Alemania" },
  { code: "CH", tz: "Europe/Zurich", en: "Switzerland", es: "Suiza" },
];

export const countryName = (c: Country): string => (isEs() ? c.es : c.en);

/** IANA zone air times render in: the device's own (undefined → the runtime
 *  default) unless a country was picked explicitly, which overrides it. */
export function airTimeZone(): string | undefined {
  const { country } = getSettings();
  if (country === "auto") return undefined;
  return COUNTRIES.find((c) => c.code === country)?.tz;
}

/** The device's own IANA zone, for labelling the "auto" choice. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/* ── Air-time formatting ────────────────────────────────────────────────────
   Every air date/time in the UI goes through these, so the active zone is
   applied in exactly one place. Episodes whose air_time_source is 'estimated'
   carry a 21:00 UTC placeholder rather than a real broadcast time — callers
   must render fmtAirDate alone for those and never fmtAirTime, which would
   present an invented clock as fact. */

export const fmtAirTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString(dateLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: airTimeZone(),
  });

export const fmtAirDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(dateLocale(), {
    month: "short",
    day: "numeric",
    timeZone: airTimeZone(),
  });

/** Long form of an *instant* — an episode's air_datetime. */
export const fmtAirDateLong = (iso: string): string =>
  new Date(iso).toLocaleDateString(dateLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: airTimeZone(),
  });

/** Long form of a bare calendar date — TMDB's 'YYYY-MM-DD', which carries no
 *  time and no zone. Date parses it as UTC midnight, so it has to be formatted
 *  in UTC as well: run it through a negative-offset zone and a premiere dated
 *  the 17th renders as the 16th. */
export const fmtPlainDate = (ymd: string): string =>
  new Date(ymd).toLocaleDateString(dateLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** True when the row carries a real broadcast time worth printing. */
export const hasRealAirTime = (source: string | null | undefined): boolean =>
  source === "tvmaze";
