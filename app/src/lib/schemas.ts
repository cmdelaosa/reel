import { z } from "zod";

/* Zod schemas for the tmdb-proxy edge function's RESPONSE shapes (cached rows,
   not raw TMDB). The Deno function mirrors these minimally; the client validates
   every response against them before use. */

export const titleRowSchema = z.object({
  id: z.string().uuid(),
  tmdb_id: z.number().int(),
  kind: z.enum(["tv", "movie"]),
  name: z.string(),
  // Localization columns (0046). Optional so rows from a DB that predates the
  // migration — or older persisted cache entries — still validate.
  original_name: z.string().nullable().optional(),
  name_es: z.string().nullable().optional(),
  overview_es: z.string().nullable().optional(),
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
  // IMDb score (0057), imported from IMDb's published datasets by
  // scripts/imdb-ratings. Optional so rows from a DB that predates the column —
  // or older persisted cache — still parse, and null while a title hasn't been
  // matched (no imdb_id, or absent from the dataset).
  imdb_rating: z.number().nullable().optional(),
  imdb_votes: z.number().int().nullable().optional(),
  // Present on full DB/proxy rows. Search fixtures and older persisted cache
  // entries may omit it, so keep it optional for backwards compatibility.
  //
  // Two marks, two meanings (0066): last_refreshed_at says the title's detail
  // was refetched — the nightly discovery warm-up writes it for the whole
  // popular-now pool without touching an episode — while episodes_refreshed_at
  // says the episodes were. Anything deciding whether to revalidate a SEASON
  // must read the second; reading the first is what let those titles serve
  // months-old episodes as fresh.
  last_refreshed_at: z.string().nullable().optional(),
  episodes_refreshed_at: z.string().nullable().optional(),
  // La saga de una película (0067) — lo que en una serie son las temporadas.
  // Opcionales por lo de siempre (una base o una caché anteriores a la
  // migración) y nulas en series y en las películas sueltas.
  collection_id: z.number().int().nullable().optional(),
  collection_name: z.string().nullable().optional(),
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
  // Per-episode scores (0057). TMDB's ride along in every season payload; IMDb's
  // come from scripts/imdb-ratings. imdb_id is the episode's own tconst. All optional (older
  // DB/persisted cache) and nullable (not yet resolved) — the UI hides absent
  // scores rather than showing a zero.
  tmdb_vote_average: z.number().nullable().optional(),
  tmdb_vote_count: z.number().int().nullable().optional(),
  imdb_rating: z.number().nullable().optional(),
  imdb_votes: z.number().int().nullable().optional(),
  imdb_id: z.string().nullable().optional(),
});
export type EpisodeRow = z.infer<typeof episodeRowSchema>;

export const profileRowSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  country: z.string().nullable(),
  is_private: z.boolean(),
  created_at: z.string(),
});
export type ProfileRow = z.infer<typeof profileRowSchema>;

/** Placeholder handles come from the signup trigger ('user_' + 16 hex);
 *  onboarding (P1-C4) replaces them and this returns false. */
export const isPlaceholderHandle = (handle: string) => /^user_[0-9a-f]{16}$/.test(handle);

/** Row shape of rpc_library_rollup — the followed library + status inputs. */
export const libraryRowSchema = z.object({
  title_id: z.string().uuid(),
  tmdb_id: z.number().int(),
  // El medio (0067). Una sola biblioteca para los dos modos; quien la lee
  // decide qué mitad enseña. Opcional para que una base anterior a la
  // migración siga validando — se lee como 'tv', que es lo que había.
  kind: z.enum(["tv", "movie"]).optional().default("tv"),
  name: z.string(),
  poster_path: z.string().nullable(),
  first_air_date: z.string().nullable(),
  tmdb_status: z.string().nullable(),
  genres: z.array(z.string()),
  network: z.string().nullable(),
  vote_average: z.number().nullable(),
  favorite: z.boolean(),
  notify: z.boolean(),
  stopped: z.boolean(),
  added_at: z.string(),
  aired_count: z.number().int(),
  watched_count: z.number().int(),
  last_watched_at: z.string().nullable(),
  last_aired_datetime: z.string().nullable(),
  next_air_datetime: z.string().nullable(),
  upcoming_season_number: z.number().int().nullable(),
  upcoming_season_air_date: z.string().nullable(),
});
export type LibraryRow = z.infer<typeof libraryRowSchema>;

export const searchResponseSchema = z.object({ results: z.array(titleRowSchema) });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/* ---- tmdb-proxy credits/person shapes (no DB cache behind them) ---- */

export const castMemberSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  profile_path: z.string().nullable(),
  character: z.string().nullable(),
  episode_count: z.number().int().nullable(),
});
export type CastMember = z.infer<typeof castMemberSchema>;

export const creditsResponseSchema = z.object({ cast: z.array(castMemberSchema) });

/* Dirección y guion de una película. No existe en series: allí el reparto es
   agregado de toda la serie y quien dirige cambia cada episodio, así que no hay
   una persona a la que atribuirla. En cine sí, y es un enlace a su ficha. */
export const crewMemberSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  profile_path: z.string().nullable(),
  job: z.string(),
});
export type CrewMember = z.infer<typeof crewMemberSchema>;

export const movieCreditsResponseSchema = z.object({
  cast: z.array(castMemberSchema),
  crew: z.array(crewMemberSchema),
});
export type MovieCreditsResponse = z.infer<typeof movieCreditsResponseSchema>;

/* `episode_id` es el episodio sintético de la película (0067): la fila que
   marcar "vista" escribe en watch_events, que sigue siendo una tabla de
   episodios. Nulo solo si el título se guardó esquivando el trigger — la ficha
   se dibuja entonces sin botón de marcar, en vez de con uno que fallaría. */
export const movieResponseSchema = z.object({
  title: titleRowSchema,
  episode_id: z.string().uuid().nullable(),
});
export type MovieResponse = z.infer<typeof movieResponseSchema>;

export const sagaResponseSchema = z.object({
  collection: z.object({ id: z.number().int(), name: z.string().nullable() }).nullable(),
  parts: z.array(titleRowSchema),
});
export type SagaResponse = z.infer<typeof sagaResponseSchema>;

export const personShowSchema = z.object({
  tmdb_id: z.number().int(),
  name: z.string(),
  poster_path: z.string().nullable(),
  first_air_date: z.string().nullable(),
  vote_average: z.number().nullable(),
  character: z.string().nullable(),
  episode_count: z.number().int().nullable(),
});
export type PersonShow = z.infer<typeof personShowSchema>;

export const personResponseSchema = z.object({
  person: z.object({
    id: z.number().int(),
    name: z.string(),
    profile_path: z.string().nullable(),
    known_for_department: z.string().nullable(),
    birthday: z.string().nullable(),
    place_of_birth: z.string().nullable(),
    // Optional: a deployed proxy that predates these fields must not fail the
    // parse — the page just renders without them.
    deathday: z.string().nullish(),
    biography: z.string().nullish(),
    biography_es: z.string().nullish(),
  }),
  shows: z.array(personShowSchema),
});
export type PersonResponse = z.infer<typeof personResponseSchema>;

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
