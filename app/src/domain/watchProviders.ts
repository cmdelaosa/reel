/* Where a title can be watched, per country, derived from TMDB's
   watch/providers payload (the `watch/providers` append on `/tv/{id}`).

   `titles.network` answers a different question — the show's *original*
   broadcast network, which for a viewer in Spain has always meant ABC or FX.
   True about the show, useless for "what do I put this on with". This is the
   second answer, and it's the one the posters, the calendar and the detail
   header now carry. The profile's top-networks stat keeps using `network`:
   what kind of shows you watch shouldn't change because a licence moved.

   This is the canonical spec. The tmdb-proxy and episode-refresh edge
   functions hand-mirror it (no cross-runtime import), same as they mirror
   airedCount and the row shapes. */

export interface TmdbProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
}

/** One country's entry in TMDB's `results`, minus the buckets we ignore. */
export interface TmdbProviderBuckets {
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  /* rent/buy exist in the payload and are deliberately not read. */
}

export interface StoredProvider {
  name: string;
  logo_path: string | null;
}

/* TMDB names the same brand differently as a provider than as a network
   ("Disney Plus" vs "Disney+") and splits the ad-supported tiers into their
   own entries with their own ids. Both matter downstream: the client draws
   providers with the very NetworkLogo that switches on these exact strings,
   and the logo cache is keyed by name. One spelling per brand, decided here. */
const ALIASES: Record<string, string> = {
  "Amazon Prime Video": "Prime Video",
  "Disney Plus": "Disney+",
  "Apple TV Plus": "Apple TV+",
  /* TMDB renamed the subscription service from "Apple TV+" to plain "Apple
     TV", and calls the rent/buy storefront "Apple TV Store". We only ever read
     subscription buckets, so an "Apple TV" here is always the service — and
     under the old name it gets the bundled Apple vector instead of generic
     art. */
  "Apple TV": "Apple TV+",
};

/* TMDB also lists a service once per storefront it's resold through: Spain
   returns both "HBO Max" and "HBO Max Amazon Channel" for the same show, and
   Germany adds "Wow Fiction Amazon Channel" next to "WOW". They are one
   service billed two ways, and left alone they would burn the poster's second
   and third logo slots on a repeat of the first.

   Sub-packages ("Movistar Plus+ Ficción Total") are deliberately NOT folded
   into their parent: that one is a real add-on you might not have, and
   claiming plain Movistar Plus+ would be telling you a show is available on a
   subscription you're paying for when it isn't. */
const RESELLER = /\s+(amazon|apple tv|roku)\s+channel$/i;
/* The tier word is optional: TMDB ships "Netflix Standard with Ads" but also a
   bare "Amazon Prime Video with Ads", which is why Spain returns Prime Video
   twice for Monk and Mr. Bean. */
const AD_TIER = /\s+(basic\s+|standard\s+)?with\s+ads$/i;

/** "HBO Max Amazon Channel" → "HBO Max"; "Amazon Prime Video with Ads" →
 *  "Prime Video"; "Disney Plus" → "Disney+". Also trims: TMDB ships trailing
 *  spaces on some names ("Movistar Plus+ Ficción Total "). */
export function canonicalProvider(name: string): string {
  const base = name.replace(RESELLER, "").replace(AD_TIER, "").trim();
  return ALIASES[base] ?? base;
}

/* Subscription-shaped access only. Rent and buy are dropped because nearly
   every catalogue title is rentable on Apple TV and Google Play — keeping them
   would stamp the same two logos across half the library and bury the signal
   this data exists to carry. A country left with nothing is stored as nothing,
   and the UI shows no logo: "not available to you here" is a real answer. */
const BUCKETS = ["flatrate", "free", "ads"] as const;

/** TMDB `results` → the shape `titles.providers` holds, all countries at once.
 *  Order is TMDB's own display_priority within a country; a brand appearing in
 *  two buckets is kept once, at its best position. */
export function providerMap(
  results: Record<string, TmdbProviderBuckets> | null | undefined,
): Record<string, StoredProvider[]> {
  if (!results || typeof results !== "object") return {};

  const out: Record<string, StoredProvider[]> = {};
  for (const [country, buckets] of Object.entries(results)) {
    const seen = new Set<string>();
    /* Also dedup on the artwork. A sub-package we deliberately keep distinct
       by name ("Movistar Plus+ Ficción Total" vs "Movistar Plus+") shares its
       parent's icon in TMDB, so a show carried by both drew the identical tile
       twice — two thirds of the poster's badge row saying one thing. The first
       survivor wins, which is TMDB's own display_priority, and a show carried
       only by the add-on still reports the add-on by name. */
    const seenArt = new Set<string>();
    const list: StoredProvider[] = [];
    for (const bucket of BUCKETS) {
      for (const p of buckets?.[bucket] ?? []) {
        if (!p?.provider_name) continue;
        const name = canonicalProvider(p.provider_name);
        const art = p.logo_path ?? null;
        if (seen.has(name) || (art && seenArt.has(art))) continue;
        seen.add(name);
        if (art) seenArt.add(art);
        list.push({ name, logo_path: art });
      }
    }
    /* Finally, drop any entry that merely extends another one present in the
       same country. Spain returns "Movistar Plus+" and "Movistar Plus+
       Ficción Total" for the same show, with near-identical icons under
       different file names — two of the poster's three badge slots spent
       saying one thing. The parent survives whichever order TMDB listed them
       in, and a show carried *only* by the add-on has nothing to fold into and
       keeps its own name, so nothing is claimed that isn't true. */
    const merged = list.filter(
      (a) => !list.some((b) => b !== a && a.name.startsWith(`${b.name} `)),
    );
    if (merged.length) out[country] = merged;
  }
  return out;
}
