import { supabase } from "@/lib/supabase";
import { isEs } from "@/lib/i18n";
import {
  searchResponseSchema,
  titleResponseSchema,
  seasonResponseSchema,
  creditsResponseSchema,
  personResponseSchema,
  type CastMember,
  type PersonResponse,
  type TitleRow,
  type TitleResponse,
  type SeasonResponse,
} from "@/lib/schemas";

/* Typed client for the tmdb-proxy edge function. Every call carries the user's
   session token (the function rejects anon) and validates the response with the
   shared zod schemas before returning. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tmdb-proxy`;
const FRESH_MS = 24 * 60 * 60 * 1000;

/** Full TMDB image URL for a cached *_path column (null-safe). */
export function tmdbImg(path: string | null | undefined, size: "w92" | "w185" | "w342" | "w780" | "h632" | "original" = "w342"): string | undefined {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

async function call(path: string): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${FUNCTION_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`tmdb-proxy ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function isFresh(iso: string | null | undefined): boolean {
  return Boolean(iso) && Date.now() - new Date(iso!).getTime() < FRESH_MS;
}

export async function searchShows(q: string): Promise<TitleRow[]> {
  // lang=es asks the proxy to patch name_es/original_name from the es-ES
  // translation set so the palette can display Spanish titles.
  const lang = isEs() ? "&lang=es" : "";
  const json = await call(`/search?q=${encodeURIComponent(q)}${lang}`);
  return searchResponseSchema.parse(json).results;
}

/** Aggregate TV cast for a show (top-billed, from the proxy). Silent-fail:
 *  against a proxy that predates the /credits route the sheet simply renders
 *  without a cast rail — never a toast. */
export async function getCredits(tmdbId: number): Promise<CastMember[]> {
  try {
    const json = await call(`/title/${tmdbId}/credits`);
    return creditsResponseSchema.parse(json).cast;
  } catch {
    return [];
  }
}

/** An actor plus their TV credits, shaped for the person page. */
export async function getPerson(personId: number): Promise<PersonResponse> {
  // v2: cache-buster — the proxy caches /person for 24h in the browser
  // (private, max-age) and v1 responses predate the biography fields. Bump
  // when the response shape grows again.
  const json = await call(`/person/${personId}?v=2`);
  return personResponseSchema.parse(json);
}

export async function getTrending(): Promise<TitleRow[]> {
  const json = await call(`/trending`);
  return searchResponseSchema.parse(json).results;
}

/** "Popular now": shows with a season premiere in the last ~90 days or the
 *  next ~30, ranked by TMDB popularity (server-cached 24h). */
export async function getPopularNow(): Promise<TitleRow[]> {
  const json = await call(`/popular-now`);
  return searchResponseSchema.parse(json).results;
}

/** Popular TV shows (by popularity), optionally restricted to a first-air-year
 *  range. `from`/`to` are 4-digit years; omit either end for an open bound. */
export async function getPopular(from?: number | null, to?: number | null): Promise<TitleRow[]> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", String(from));
  if (to) qs.set("to", String(to));
  const suffix = qs.toString() ? `?${qs}` : "";
  const json = await call(`/popular${suffix}`);
  return searchResponseSchema.parse(json).results;
}

/** Top-rated TV shows (by TMDB score, with a server-side vote-count floor),
 *  optionally restricted to a first-air-year range and/or TMDB genre ids
 *  (OR across ids). */
export async function getTopRated(from?: number | null, to?: number | null, genreIds: number[] = []): Promise<TitleRow[]> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", String(from));
  if (to) qs.set("to", String(to));
  if (genreIds.length) qs.set("genres", genreIds.join(","));
  const suffix = qs.toString() ? `?${qs}` : "";
  const json = await call(`/top-rated${suffix}`);
  return searchResponseSchema.parse(json).results;
}

/** Titles for a curated collection, resolved live from TMDB discover by the
 *  proxy (criteria live server-side, keyed by slug). */
export async function getCollectionTitles(slug: string): Promise<TitleRow[]> {
  const json = await call(`/collection/${encodeURIComponent(slug)}`);
  return searchResponseSchema.parse(json).results;
}

export async function getTitle(tmdbId: number): Promise<TitleResponse> {
  // Warm path: metadata tables are authenticated-readable already. Going
  // straight to PostgREST avoids an Edge cold start plus repeated auth/invite
  // and service-role DB round trips. The proxy remains the cache-fill path.
  const { data, error } = await supabase
    .from("titles")
    .select("*, seasons(*)")
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (!error && data && Array.isArray(data.seasons) && data.seasons.length > 0) {
    const parsed = titleResponseSchema.parse({
      title: data,
      seasons: [...data.seasons].sort((a, b) => a.number - b.number),
    });
    // Stale-while-revalidate: render the DB row now and let the proxy refresh
    // it out of band. A failed refresh never turns a cache hit into an error.
    if (!isFresh(parsed.title.last_refreshed_at)) {
      void call(`/title/${tmdbId}`).catch(() => {});
    }
    return parsed;
  }

  const json = await call(`/title/${tmdbId}`);
  return titleResponseSchema.parse(json);
}

export async function getSeason(
  tmdbId: number,
  n: number,
  titleId?: string,
  titleRefreshedAt?: string | null,
): Promise<SeasonResponse> {
  if (titleId) {
    const { data, error } = await supabase
      .from("seasons")
      .select("*, episodes(*)")
      .eq("title_id", titleId)
      .eq("number", n)
      .maybeSingle();

    if (!error && data && Array.isArray(data.episodes) && data.episodes.length > 0) {
      const parsed = seasonResponseSchema.parse({
        season: data,
        episodes: [...data.episodes].sort((a, b) => a.episode_number - b.episode_number),
      });
      const complete = parsed.season.episode_count == null || parsed.episodes.length >= parsed.season.episode_count;
      if (!complete || !isFresh(titleRefreshedAt)) {
        void call(`/title/${tmdbId}/season/${n}`).catch(() => {});
      }
      return parsed;
    }
  }

  const json = await call(`/title/${tmdbId}/season/${n}`);
  return seasonResponseSchema.parse(json);
}
