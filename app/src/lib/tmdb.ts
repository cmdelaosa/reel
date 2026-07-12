import { supabase } from "@/lib/supabase";
import {
  searchResponseSchema,
  titleResponseSchema,
  seasonResponseSchema,
  type TitleRow,
  type TitleResponse,
  type SeasonResponse,
} from "@/lib/schemas";

/* Typed client for the tmdb-proxy edge function. Every call carries the user's
   session token (the function rejects anon) and validates the response with the
   shared zod schemas before returning. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tmdb-proxy`;

/** Full TMDB image URL for a cached *_path column (null-safe). */
export function tmdbImg(path: string | null | undefined, size: "w92" | "w342" | "w780" | "original" = "w342"): string | undefined {
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

export async function searchShows(q: string): Promise<TitleRow[]> {
  const json = await call(`/search?q=${encodeURIComponent(q)}`);
  return searchResponseSchema.parse(json).results;
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
  const json = await call(`/title/${tmdbId}`);
  return titleResponseSchema.parse(json);
}

export async function getSeason(tmdbId: number, n: number): Promise<SeasonResponse> {
  const json = await call(`/title/${tmdbId}/season/${n}`);
  return seasonResponseSchema.parse(json);
}
