/** Which platform's release rule dates a title, and what that rule is.
 *
 *  A streamer publishes no broadcast clock, so TVmaze carries none for it and
 *  the episode would sit on the 21:00 placeholder. What it does have is a
 *  release convention — Netflix at midnight Pacific, Apple at midnight Eastern
 *  — and that convention is the clock.
 *
 *  The rule was looked up by `titles.network` alone, which is where TMDB files
 *  the ORIGINAL BROADCASTER. For a streaming show that is either the wrong
 *  answer or an archaeological one: Adults says "FX" and Futurama says "FOX",
 *  and both of them stream on Disney+ in Spain and Hulu in the States. So
 *  `titles.providers` — the same per-country map the UI draws its "where to
 *  watch" logos from — now answers for the titles the network cannot.
 *
 *  It answers SECOND, though, and that order was arrived at the hard way. A
 *  provider list is ordered by TMDB's display_priority, which is commercial
 *  prominence and not who releases the thing: in Spain both Ted Lasso and Silo
 *  list "Prime Video" ahead of "Apple TV+", because Apple sells itself as a
 *  channel inside Prime. Reading providers first moved two Apple originals off
 *  Apple's own release convention (midnight ET, with the day shift) and onto
 *  Netflix-style midnight Pacific. When the network IS a streamer we have a
 *  rule for, it remains the best evidence we have about who releases it, so
 *  providers only ever fill a gap — never overrule.
 */

/** `days` are the weekdays (0 = Sunday) a platform releases on, and only Apple
 *  needs them: it is the one streamer whose TMDB dates are filed in a zone far
 *  enough west to fall on the previous day. See releaseDay in index.ts. */
export interface PlatformRelease {
  at: string;
  tz: string;
  days?: readonly number[];
}

/** Only platforms whose release instant we can actually stand behind.
 *
 *  Deliberately short. Hulu, Peacock, HBO Max and SkyShowtime all carry titles
 *  in this library and none of them is here, because no source we have states
 *  when they drop, and a confident wrong hour is worse than no hour — the same
 *  judgement that makes resolveAirTime refuse TVmaze's noon-UTC filler stamp
 *  rather than print it, after that stamp had Stranger Things arriving at
 *  14:00. Those titles keep the placeholder and the UI shows the day alone.
 *  Add a platform here when its instant can be checked against something. */
export const PLATFORM_RELEASE: Readonly<Record<string, PlatformRelease>> = {
  // 21:00 PT the evening before, which is this, and is why `days` is here.
  "Apple TV": { at: "00:00", tz: "America/New_York", days: [3, 5] },
  "Apple TV+": { at: "00:00", tz: "America/New_York", days: [3, 5] },
  Netflix: { at: "00:00", tz: "America/Los_Angeles" },
  "Disney+": { at: "00:00", tz: "America/Los_Angeles" },
  "Prime Video": { at: "00:00", tz: "America/Los_Angeles" },
  "Amazon Prime Video": { at: "00:00", tz: "America/Los_Angeles" },
};

export const platformRelease = (name: string | null | undefined): PlatformRelease | null =>
  (name && PLATFORM_RELEASE[name]) || null;

/** Countries whose provider list is consulted, in order.
 *
 *  ES first because it is the market every viewer here watches from (the app's
 *  FALLBACK_COUNTRY, and no profile has ever set another), so when a show runs
 *  on different services either side of the Atlantic, the Spanish one decides.
 *  US second for the reach: a title absent from Spain often still resolves
 *  there, and every rule in the table above is a worldwide simultaneous drop,
 *  so borrowing the American service's clock does not move the instant. */
export const PROVIDER_COUNTRIES = ["ES", "US"] as const;

export interface ProviderEntry {
  name?: string | null;
}

export interface PlatformSource {
  providers?: Record<string, ProviderEntry[] | null | undefined> | null;
  network?: string | null;
}

/** The name to date this title by: the network if it has a rule, else the first
 *  provider that does, ES before US.
 *
 *  "First WITH A RULE", not "first provider" — a Spanish list often opens with
 *  Movistar Plus+, and stopping there would drop a title the next entry could
 *  have dated. Together with the network going first, that makes this purely
 *  additive: every title that had a clock keeps exactly the one it had, and the
 *  only rows that move are the ones that had none.
 */
export function rulePlatform(title: PlatformSource): string | null {
  const candidates: (string | null | undefined)[] = [title.network];
  for (const country of PROVIDER_COUNTRIES) {
    for (const p of title.providers?.[country] ?? []) candidates.push(p?.name);
  }
  return candidates.find((name) => platformRelease(name)) ?? null;
}
