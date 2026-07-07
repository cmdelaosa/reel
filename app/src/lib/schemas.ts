import { z } from "zod";

/* Zod schemas for the tmdb-proxy edge function's RESPONSE shapes (cached rows,
   not raw TMDB). The Deno function mirrors these minimally; the client validates
   every response against them before use. */

export const titleRowSchema = z.object({
  id: z.string().uuid(),
  tmdb_id: z.number().int(),
  kind: z.enum(["tv", "movie"]),
  name: z.string(),
  overview: z.string().nullable(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable(),
  first_air_date: z.string().nullable(), // 'YYYY-MM-DD'
  status: z.string().nullable(),
  genres: z.array(z.string()),
  network: z.string().nullable(),
  episode_run_time: z.number().int().nullable(),
  vote_average: z.number().nullable(),
  popularity: z.number().nullable(),
});
export type TitleRow = z.infer<typeof titleRowSchema>;

export const seasonRowSchema = z.object({
  id: z.string().uuid(),
  title_id: z.string().uuid(),
  tmdb_id: z.number().int().nullable(),
  number: z.number().int(),
  name: z.string().nullable(),
  episode_count: z.number().int().nullable(),
  air_date: z.string().nullable(),
});
export type SeasonRow = z.infer<typeof seasonRowSchema>;

export const episodeRowSchema = z.object({
  id: z.string().uuid(),
  title_id: z.string().uuid(),
  season_id: z.string().uuid().nullable(),
  tmdb_id: z.number().int().nullable(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  name: z.string().nullable(),
  overview: z.string().nullable(),
  runtime: z.number().int().nullable(),
  air_datetime: z.string().nullable(), // ISO 8601 UTC
});
export type EpisodeRow = z.infer<typeof episodeRowSchema>;

export const searchResponseSchema = z.object({ results: z.array(titleRowSchema) });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const titleResponseSchema = z.object({
  title: titleRowSchema,
  seasons: z.array(seasonRowSchema),
});
export type TitleResponse = z.infer<typeof titleResponseSchema>;

export const seasonResponseSchema = z.object({
  season: seasonRowSchema,
  episodes: z.array(episodeRowSchema),
});
export type SeasonResponse = z.infer<typeof seasonResponseSchema>;
