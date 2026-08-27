import { z } from "zod";

/* Zod schemas for the tmdb-proxy edge function's RESPONSE shapes (cached rows,
   not raw TMDB). The Deno function mirrors these minimally; the client validates
   every response against them before use. */

export const titleRowSchema = z.object({
  id: z.string().uuid(),
  tmdb_id: z.number().int(),
  kind: z.enum(["tv", "movie", "game"]),
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
  /* Videojuegos (0071). Opcionales por lo mismo que las de localización: una
     base anterior a la migración, o una entrada vieja de la caché persistida,
     siguen validando. En series y películas llegan nulas o vacías.

     `poster_path` en un juego NO es una ruta de TMDB sino el hash de la imagen
     en IGDB; quien lo pinta usa igdbImg() y no tmdbImg(). El tipo es el mismo
     string, así que esto solo lo dice el comentario. */
  release_precision: z
    .enum(["day", "month", "q1", "q2", "q3", "q4", "year", "tbd"])
    .nullable()
    .optional(),
  platforms: z.array(z.string()).nullable().optional(),
  platform_releases: z
    .record(z.string(), z.object({ date: z.string(), precision: z.string() }))
    .nullable()
    .optional(),
  beat_seconds: z
    .object({
      hastily: z.number().optional(),
      normally: z.number().optional(),
      completely: z.number().optional(),
      /* De cuántas estimaciones salen las tres cifras. La ficha lo enseña
         porque con veintiocho no es lo mismo que con dos mil. */
      count: z.number().optional(),
    })
    .nullable()
    .optional(),
  steam_appid: z.number().int().nullable().optional(),
  /* La ficha ampliada de un juego (0086). Todas opcionales por lo de siempre
     —una caché persistida anterior a la migración— y nulas cuando IGDB o Steam
     no tienen ese dato, que la ficha lee como "no pintes esa sección". En
     series y películas llegan nulas.

     `screenshots` y `videos` son hashes e ids de YouTube, no rutas: los pinta
     igdbImg() y el reproductor. `age_ratings` viene con los nombres ya
     resueltos ("PEGI", "18") porque el mapa de enums es de IGDB y cambia allí,
     no aquí. De `steam_reviews` NO viaja la etiqueta: la pone el cliente en el
     idioma de quien mira (ver domain/steamReviews). */
  screenshots: z.array(z.string()).nullable().optional(),
  videos: z.array(z.object({ name: z.string(), video_id: z.string() })).nullable().optional(),
  age_ratings: z.array(z.object({ org: z.string(), rating: z.string() })).nullable().optional(),
  official_url: z.string().nullable().optional(),
  steam_reviews: z.object({ percent: z.number(), count: z.number().int() }).nullable().optional(),
  metacritic: z.number().int().nullable().optional(),
  /* `network` guarda el desarrollador (studio() lo resuelve así desde 0071);
     esta es la otra mitad de involved_companies. Se guardan las dos aunque
     coincidan: que un juego se autodistribuya es un dato, no un duplicado. */
  publisher: z.string().nullable().optional(),
  game_modes: z.array(z.string()).nullable().optional(),
  // IMDb score (0057), imported from IMDb's published datasets by
  // scripts/imdb-ratings. Optional so rows from a DB that predates the column —
  // or older persisted cache — still parse, and null while a title hasn't been
  // matched (no imdb_id, or absent from the dataset).
  imdb_rating: z.number().nullable().optional(),
  imdb_votes: z.number().int().nullable().optional(),
  /* El tconst del título. Existe en la base desde 0051 —TMDB lo da y es el
     puente por el que scripts/imdb-ratings encuentra la nota— pero no estaba
     en este esquema, así que la fila lo traía y Zod lo tiraba. Lo expone ahora
     porque la ficha enlaza a la página de IMDb del título, que es lo único que
     falta para que ese enlace exista. */
  imdb_id: z.string().nullable().optional(),
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
  // Fechas de estreno por país y tipo (0068), {"ES": {theatrical, digital}}.
  // Null en series y en las películas que TMDB aún no fecha en ningún país.
  release_dates: z.record(z.string(), z.record(z.string(), z.string())).nullable().optional(),
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

/** Una persona de la ficha de un episodio: dirección, guion o invitado.
 *
 *  `role` es el puesto ("Director", "Writer") cuando viene del equipo y el
 *  PERSONAJE cuando viene de los invitados. Una sola forma para las dos listas
 *  porque se pintan con la misma fila de caras, y el `id` es lo que deja que
 *  cada una enlace a /person/:id. El recorte lo hace el proxy
 *  (supabase/functions/tmdb-proxy/episodio.ts), que es donde están sus tests. */
export const personaSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  profile_path: z.string().nullable(),
  role: z.string(),
});
export type Persona = z.infer<typeof personaSchema>;

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
  /* La ficha del episodio (0087). Los cuatro venían ya en el payload de
     temporada y se descartaban en el ingest; el par _es sigue la misma regla
     que en `titles` — la columna canónica manda y la traducción solo existe
     cuando TMDB la tiene.

     Opcionales por lo de siempre (una caché persistida anterior a la
     migración) y nulos mientras no se hayan traído. La interfaz lee la
     ausencia como "no enseñar", nunca como una lista vacía: un episodio sin
     emitir no tiene reparto porque TMDB lo publica al emitirse, y eso la ficha
     lo dice con palabras en vez de con un hueco. */
  still_path: z.string().nullable().optional(),
  episode_type: z.string().nullable().optional(),
  crew: z.array(personaSchema).nullable().optional(),
  guest_stars: z.array(personaSchema).nullable().optional(),
  name_es: z.string().nullable().optional(),
  overview_es: z.string().nullable().optional(),
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
  kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
  name: z.string(),
  poster_path: z.string().nullable(),
  /* La imagen apaisada del banner de Esta noche (0081). Opcional con respaldo a
     null por lo mismo que `kind`: una base anterior a esa migración devuelve la
     fila sin este campo, y un `nullable()` a secas la haría fallar entera — o
     sea, biblioteca vacía en vez de banner con la carátula. */
  backdrop_path: z.string().nullable().optional().default(null),
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
  /* Videojuegos (0073). `play_state` es lo que la persona dijo a mano;
     TERMINADO no está aquí — es watched_count, el mismo watch_event que en los
     otros dos medios. Ver domain/gameStatus.ts. */
  play_state: z.enum(["backlog", "playing", "ongoing", "dropped"]).nullable().optional(),
  minutes_played: z.number().int().nullable().optional(),
  /* Cuándo tocaste el juego por última vez (0075) — lo escribe un disparador
     cuando cambian las horas o el estado. NO es "cuándo lo terminaste", que es
     last_watched_at. Null en las filas anteriores a la migración, que no se
     rellenaron a propósito: ordenar cae a added_at (domain/gameTonight). */
  played_at: z.string().nullable().optional(),
  /* Steam (0076). `owned` es ortogonal al estado —"es mío", no "voy por
     aquí"— y saca de "Pendientes" lo que tienes y no has empezado; ver
     domain/gameStatus.ts. `minutes_source` es lo que deja a la ficha decir de
     dónde salen las horas sin una consulta más. */
  owned: z.boolean().nullable().optional(),
  minutes_source: z.enum(["manual", "steam"]).nullable().optional(),
  /* En cuál lo juegas TÚ (0083), por su nombre de IGDB — el mismo de
     `platforms`, que es la lista que la ficha ofrece a elegir. Una sola y no
     varias: la pregunta es "¿dónde lo juego?", y esa respuesta cambia cuando
     te lo llevas a otra consola, no se acumula. Null es "no lo has dicho". */
  played_platform: z.string().nullable().optional(),
  release_precision: z
    .enum(["day", "month", "q1", "q2", "q3", "q4", "year", "tbd"])
    .nullable()
    .optional(),
  platforms: z.array(z.string()).nullable().optional(),
  beat_seconds: z
    .object({
      hastily: z.number().optional(),
      normally: z.number().optional(),
      completely: z.number().optional(),
      /* De cuántas estimaciones salen las tres cifras. La ficha lo enseña
         porque con veintiocho no es lo mismo que con dos mil. */
      count: z.number().optional(),
    })
    .nullable()
    .optional(),
  /* La nota de IMDb (0080). Es la que la carátula de una película enseña —con
     la de TMDB de reserva, ver domain/externalScore—, y viaja en el rollup para
     que Tus pelis no diga un número distinto del que dice Explorar. Opcional
     porque una base anterior a 0080 no la devuelve. */
  imdb_rating: z.number().nullable().optional(),
});
export type LibraryRow = z.infer<typeof libraryRowSchema>;

/* ---- igdb-proxy ---- */

export const gameSearchResponseSchema = z.object({ results: z.array(titleRowSchema) });

/** La ficha de un juego. `episode_id` es el episodio sintético (0071), que es
 *  donde se escribe "terminado" — mismo trato que en cine y por el mismo
 *  motivo: watch_events sigue siendo una tabla de episodios. */
export const gameResponseSchema = z.object({
  title: titleRowSchema,
  episode_id: z.string().uuid().nullable(),
});
export type GameResponse = z.infer<typeof gameResponseSchema>;

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

/** Fila de rpc_movie_releases — un ESTRENO, no una película: la que tiene fecha
 *  de cine y de streaming devuelve dos, con la misma marca de vista. */
export const movieReleaseSchema = z.object({
  title_id: z.string().uuid(),
  tmdb_id: z.number().int(),
  name: z.string(),
  poster_path: z.string().nullable(),
  genres: z.array(z.string()),
  runtime: z.number().int().nullable(),
  vote_average: z.number().nullable(),
  release_kind: z.enum(["theatrical", "digital", "release"]),
  release_at: z.string(),
  watch_event_id: z.string().uuid().nullable(),
});
export type MovieRelease = z.infer<typeof movieReleaseSchema>;

export const sagaResponseSchema = z.object({
  collection: z.object({ id: z.number().int(), name: z.string().nullable() }).nullable(),
  parts: z.array(titleRowSchema),
});
export type SagaResponse = z.infer<typeof sagaResponseSchema>;

export const personShowSchema = z.object({
  tmdb_id: z.number().int(),
  /* El medio de este crédito (0069): la filmografía va mezclada y cada fila
     lleva su glifo. Opcional para que un proxy anterior a la ruta siga
     validando — sus créditos eran todos de series. */
  kind: z.enum(["tv", "movie", "game"]).optional().default("tv"),
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
