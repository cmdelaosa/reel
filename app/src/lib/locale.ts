import { getSettings, type LanguageName } from "@/lib/settings";

/* Locale primitives — which language is active, and the BCP-47 tag that
   toLocale*String / Intl want for it.

   These live apart from i18n.ts because that module also owns useEsNames,
   which needs the Supabase client — and pulling a database client in just to
   format a date drags the whole auth/query stack into anything that shows one.
   lib/region.ts is the module that made this bite: it needs nothing but the
   language, and importing i18n made it (and its tests) unloadable without
   Supabase credentials in the environment.

   i18n.ts re-exports all three, so every existing import site keeps working. */

export const lang = (): LanguageName => getSettings().language;

/** English is the source language: its strings are the keys, so it has no
 *  dictionary. isEs stays for the few value-shaping spots (word order, es-only
 *  data columns) that aren't a translatable UI string. */
export const isEs = () => lang() === "es";

/** BCP-47 locale for toLocale*String / Intl. English keeps the browser default
 *  (undefined); every other language maps here. Add a row per language. */
export const dateLocale = (): string | undefined =>
  ({ en: undefined, es: "es-ES" } as Record<LanguageName, string | undefined>)[lang()];
