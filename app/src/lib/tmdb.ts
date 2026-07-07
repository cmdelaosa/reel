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

export async function getTitle(tmdbId: number): Promise<TitleResponse> {
  const json = await call(`/title/${tmdbId}`);
  return titleResponseSchema.parse(json);
}

export async function getSeason(tmdbId: number, n: number): Promise<SeasonResponse> {
  const json = await call(`/title/${tmdbId}/season/${n}`);
  return seasonResponseSchema.parse(json);
}
