// lib/locale, not lib/i18n: the latter also owns useEsNames and so imports the
// Supabase client, which would make this module (and its tests) unloadable
// without credentials in the environment.
import { dateLocale, isEs } from "@/lib/locale";
import { COUNTRIES, type Country, FALLBACK_COUNTRY } from "@/lib/countries";
import { getSettings } from "@/lib/settings";

/* Region — the country the viewer watches from, and the two things that hang
   off it: the timezone air times render in, and the country Reel asks TMDB for
   streaming providers (lib/providers.ts). One setting drives both, so the list
   of countries can only hold single-timezone ones — see lib/countries.

   There is no "follow my device" any more. A zone is not a country, and
   providers need a country: Europe/Madrid could be Spain, but Europe/Zurich is
   as much Liechtenstein as Switzerland and America/New_York is four countries.
   The device seeds the first guess and the viewer owns it from there, which
   also means air times stay on your home clock while travelling. */

export { COUNTRIES, type Country } from "@/lib/countries";

export const countryName = (c: Country): string => (isEs() ? c.es : c.en);

const activeCountry = (): Country =>
  COUNTRIES.find((c) => c.code === getSettings().country) ??
  // Unreachable in practice: lib/settings validates the stored code on load.
  (COUNTRIES.find((c) => c.code === FALLBACK_COUNTRY) as Country);

/** ISO 3166-1 alpha-2 of the country the viewer watches from — the key into
 *  TMDB's watch/providers. */
export const regionCode = (): string => activeCountry().code;

/** IANA zone air times render in: always the chosen country's, never the
 *  device's. Travelling moves the clock on your wrist, not the schedule. */
export const airTimeZone = (): string => activeCountry().tz;

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
