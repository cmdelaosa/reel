// normalize.ts — el payload de IGDB traducido a una fila de `titles`.
//
// Vive fuera de index.ts por lo mismo que rank.ts en tmdb-proxy: index.ts
// llama a Deno.serve al importarse, así que nada de lo que hay allí se puede
// probar. Todo lo que decide algo a partir de los datos está aquí, y aquí
// están sus tests (normalize_test.ts, que corre el job `edge` de CI).
//
// La pieza con criterio propio es la de las fechas. Lo demás son mapeos.

// deno-lint-ignore no-explicit-any
export type Any = any;

/* ─────────────────────────── Fechas ───────────────────────────────────────
 *
 * IGDB acompaña cada fecha de salida de un formato — día exacto, mes,
 * trimestre, año o TBD — y ADEMÁS devuelve un timestamp para todas ellas. Un
 * juego anunciado como "Q4 2027" llega con un día concreto de octubre que
 * nadie ha prometido. Ese timestamp es la trampa: se puede guardar tal cual y
 * el resultado parece un catálogo perfectamente fechado.
 *
 * Así que de cada fecha se guardan dos cosas: el día, y cuánto de ese día es
 * real.
 *
 * ── Qué día, cuando no hay día ─────────────────────────────────────────────
 * Para un formato ancho hay que elegir un día del periodo, y la elección tiene
 * consecuencias: `first_air_date` es lo que el episodio sintético convierte en
 * "ya ha salido" (0069). Guardar el PRIMER día del periodo haría que un juego
 * de "Q4 2027" contara como salido el 1 de octubre, aunque llegue en
 * diciembre. Guardar el ÚLTIMO lo cuenta como pendiente hasta el 31.
 *
 * Se guarda el último, por dos razones. Una: de los dos errores posibles,
 * "todavía no" sobre algo que ya salió se corrige solo —cuando un juego sale
 * de verdad, IGDB le pone día exacto en cuestión de horas—, mientras que "ya
 * está fuera" sobre algo que no ha salido manda a alguien a buscarlo. Y dos:
 * en la práctica casi nunca se aplica, porque los formatos anchos existen
 * sobre todo ANTES del lanzamiento; después hay día.
 *
 * El orden no sufre: un Q1 (31 de marzo) sigue cayendo antes que un Q4 (31 de
 * diciembre) del mismo año. */

export type Precision = "day" | "month" | "q1" | "q2" | "q3" | "q4" | "year" | "tbd";

/** Los siete formatos de IGDB (`release_dates.category`), sin interpretar. */
const CATEGORY: Record<number, Precision> = {
  0: "day", // YYYYMMMMDD
  1: "month", // YYYYMMMM
  2: "year", // YYYY
  3: "q1",
  4: "q2",
  5: "q3",
  6: "q4",
  7: "tbd",
};

/** El formato en texto de la tabla nueva `date_formats`, para cuando IGDB
 *  retire el enum deprecado. Se consultan los dos y gana este (ver `precisionOf`). */
const FORMAT_TEXT: Record<string, Precision> = {
  YYYYMMMMDD: "day",
  YYYYMMMM: "month",
  YYYY: "year",
  YYYYQ1: "q1",
  YYYYQ2: "q2",
  YYYYQ3: "q3",
  YYYYQ4: "q4",
  TBD: "tbd",
};

/** El formato de una fila de release_dates.
 *
 *  IGDB está migrando sus enums a tablas: `category` (0-7) está marcado como
 *  deprecado en favor de `date_format`, que es una referencia a /date_formats
 *  y cuyo `format` es la misma etiqueta en texto. Se leen los dos y manda el
 *  nuevo, para que el día que el enum desaparezca esto no note nada. Si no
 *  llega ninguno, la fila no dice nada de su formato y no se la cree: 'tbd'. */
export function precisionOf(row: Any): Precision {
  const text = row?.date_format?.format;
  if (typeof text === "string" && FORMAT_TEXT[text]) return FORMAT_TEXT[text];
  const cat = row?.category;
  if (typeof cat === "number" && CATEGORY[cat]) return CATEGORY[cat];
  return "tbd";
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Día 0 del mes siguiente = último día de este. Cubre febrero y los bisiestos. */
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** El último día del periodo que la fila anuncia, en ISO. Null si no hay
 *  periodo (TBD, o una fila sin año, que es lo mismo dicho de otra manera).
 *
 *  Se prefieren los campos y/m/d de IGDB al timestamp: son los que la fuente
 *  considera ciertos, y no arrastran zona horaria. El timestamp solo entra
 *  cuando y falta, que pasa en filas antiguas. */
export function windowEnd(row: Any, precision: Precision): string | null {
  if (precision === "tbd") return null;

  let y = typeof row?.y === "number" ? row.y : null;
  let m = typeof row?.m === "number" ? row.m : null;
  let d = typeof row?.d === "number" ? row.d : null;

  if (y === null && typeof row?.date === "number") {
    const t = new Date(row.date * 1000);
    y = t.getUTCFullYear();
    m ??= t.getUTCMonth() + 1;
    d ??= t.getUTCDate();
  }
  if (y === null) return null;

  switch (precision) {
    case "day":
      // Un formato que dice "día exacto" sin día es una contradicción de la
      // fuente; se degrada al final del mes, que es lo que sí se sabe.
      return m === null ? iso(y, 12, 31) : iso(y, m, d ?? lastDayOfMonth(y, m));
    case "month":
      return m === null ? iso(y, 12, 31) : iso(y, m, lastDayOfMonth(y, m));
    case "q1":
      return iso(y, 3, 31);
    case "q2":
      return iso(y, 6, 30);
    case "q3":
      return iso(y, 9, 30);
    case "q4":
    case "year":
      return iso(y, 12, 31);
  }
}

export interface PlatformRelease {
  date: string;
  precision: Precision;
}

/** Las fechas de salida agrupadas por plataforma, listas para la columna
 *  `platform_releases` (0069).
 *
 *  Un juego trae una fila por (plataforma × región): la misma PS5 puede
 *  aparecer para Europa, Norteamérica y Japón con días distintos. De cada
 *  plataforma se guarda la MÁS TEMPRANA, que es la respuesta a "¿cuándo salió
 *  esto?" — la ficha no pregunta por regiones y el selector de país de Reel
 *  solo tiene tres europeos.
 *
 *  Las filas sin plataforma conocida se descartan en vez de agruparse bajo un
 *  "Otras": una fecha sin plataforma no se puede ni pintar ni filtrar, y
 *  guardarla solo serviría para que un día alguien la cuente. */
export function platformReleases(
  rows: readonly Any[] | null | undefined,
  platformNames: ReadonlyMap<number, string>,
): Record<string, PlatformRelease> {
  const out: Record<string, PlatformRelease> = {};
  for (const row of rows ?? []) {
    const id = typeof row?.platform === "number" ? row.platform : row?.platform?.id;
    const name = typeof id === "number" ? platformNames.get(id) : undefined;
    if (!name) continue;

    const precision = precisionOf(row);
    const date = windowEnd(row, precision);
    if (!date) continue;

    const held = out[name];
    if (!held || date < held.date) out[name] = { date, precision };
  }
  return out;
}

/** La fecha canónica del juego: la más temprana de todas sus plataformas, con
 *  su precisión. Es lo que va a `first_air_date` + `release_precision`, o sea
 *  lo que ordena, lo que entra en el calendario y lo que decide si ya salió.
 *
 *  Sin ninguna fecha utilizable devuelve `{date: null, precision: "tbd"}`, que
 *  es la verdad sobre un juego anunciado sin fecha y deja el episodio
 *  sintético sin `air_datetime` — o sea, en "próximamente" para siempre, hasta
 *  que IGDB fecha algo. */
export function canonicalRelease(
  byPlatform: Record<string, PlatformRelease>,
): { date: string | null; precision: Precision } {
  let best: PlatformRelease | null = null;
  for (const r of Object.values(byPlatform)) {
    if (!best || r.date < best.date) best = r;
  }
  return best ? { date: best.date, precision: best.precision } : { date: null, precision: "tbd" };
}

/* ─────────────────────────── Mapeos ─────────────────────────────────────── */

/** IGDB puntúa sobre 100 y `titles.vote_average` es sobre 10 en los otros dos
 *  medios. Se normaliza aquí para que la misma estrella del cliente valga en
 *  los tres — la alternativa era una rama por medio en cada sitio que pinta
 *  una nota.
 *
 *  `total_rating` (crítica + usuarios) antes que `rating` (solo usuarios de
 *  IGDB, que en juegos poco jugados son cuatro votos). */
export function rating10(d: Any): number | null {
  const raw = typeof d?.total_rating === "number" ? d.total_rating : d?.rating;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.round((raw / 10) * 10) / 10;
}

/** El appid de Steam, para la sincronización que llega más tarde (0069).
 *
 *  IGDB está migrando también este enum: `category === 1` es el campo viejo y
 *  `external_game_source` la referencia nueva, cuyo nombre es "Steam". Se
 *  aceptan los dos. El uid de Steam es el appid en texto. */
export function steamAppid(externals: readonly Any[] | null | undefined): number | null {
  for (const e of externals ?? []) {
    const isSteam = e?.category === 1 ||
      String(e?.external_game_source?.name ?? "").toLowerCase() === "steam";
    if (!isSteam) continue;
    const id = Number.parseInt(String(e?.uid ?? ""), 10);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return null;
}

/** Las tres medias de IGDB para terminarse un juego, en segundos.
 *
 *  Devuelve undefined —no {}— cuando no hay ninguna, para que un upsert que no
 *  pidió estos datos no vacíe lo que otro ya escribió. Es la misma regla que
 *  `providerMap` en tmdb-proxy, y por el mismo motivo: quien no lo pidió no
 *  puede borrarlo. */
export function beatSeconds(ttb: Any): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const key of ["hastily", "normally", "completely"] as const) {
    const v = ttb?.[key];
    if (typeof v === "number" && v > 0) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** El estudio que sale en la ficha, en el hueco que en series ocupa la cadena
 *  y en cine la productora.
 *
 *  El desarrollador antes que la distribuidora: es quien la gente asocia con
 *  el juego ("el nuevo de FromSoftware"), aunque la que lo publique sea
 *  Bandai Namco. Si IGDB no marca ninguno como developer, vale el primero que
 *  haya. */
export function studio(involved: readonly Any[] | null | undefined): string | null {
  const rows = involved ?? [];
  const dev = rows.find((c) => c?.developer)?.company?.name;
  if (typeof dev === "string" && dev) return dev;
  const any = rows.find((c) => typeof c?.company?.name === "string")?.company?.name;
  return any || null;
}

/** id → nombre de las plataformas que el propio payload trae expandidas.
 *  Se usa para traducir los ids de `release_dates.platform` sin una segunda
 *  petición a /platforms: la lista de plataformas de un juego siempre contiene
 *  las de sus fechas. */
export function platformIndex(platforms: readonly Any[] | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of platforms ?? []) {
    if (typeof p?.id === "number" && typeof p?.name === "string") out.set(p.id, p.name);
  }
  return out;
}

/** La fila completa de `titles` para un detalle de IGDB.
 *
 *  `ttb` es la respuesta de /game_time_to_beats para este juego (o null: no
 *  todos la tienen). Va como argumento aparte porque es otro endpoint, y esta
 *  función no hace peticiones.
 *
 *  Las columnas ausentes son deliberadas: `episode_run_time` no significa nada
 *  en un juego (lo que dura está en beat_seconds), `network` lo ocupa el
 *  estudio, y `providers` / `release_dates` / `collection_*` son de TMDB y se
 *  quedan nulas — la saga de un juego es su `collections`, que llega con la
 *  rama de la ficha. */
export function gameRow(d: Any, ttb: Any = null) {
  const platformNames = platformIndex(d?.platforms);
  const byPlatform = platformReleases(d?.release_dates, platformNames);
  const canonical = canonicalRelease(byPlatform);
  const beats = beatSeconds(ttb);

  return {
    tmdb_id: d.id,
    kind: "game",
    name: d.name ?? "Untitled",
    original_name: d.name ?? null,
    overview: d.summary ?? null,
    // El hash de la imagen, no una ruta: images.igdb.com quiere
    // /t_{size}/{hash}.jpg, y el tamaño lo elige quien pinta (ver 0069).
    poster_path: d.cover?.image_id ?? null,
    backdrop_path: d.artworks?.[0]?.image_id ?? d.screenshots?.[0]?.image_id ?? null,
    first_air_date: canonical.date,
    release_precision: canonical.precision,
    status: d.game_status?.status ?? null,
    genres: (d.genres ?? []).map((g: Any) => g.name).filter(Boolean),
    platforms: [...platformNames.values()].sort(),
    platform_releases: byPlatform,
    network: studio(d.involved_companies),
    vote_average: rating10(d),
    // `hypes` es el número de seguidores ANTES de salir y es lo único que IGDB
    // da para un juego sin lanzar; después manda el número de votos. Sumarlos
    // deja una sola columna que ordena las dos épocas sin ramas.
    popularity: (d.hypes ?? 0) + (d.total_rating_count ?? 0),
    ...(beats ? { beat_seconds: beats } : {}),
    steam_appid: steamAppid(d.external_games),
    last_refreshed_at: new Date().toISOString(),
  };
}

/** Fila parcial para los resultados de búsqueda.
 *
 *  Igual que `movieSearchRow` en tmdb-proxy: la búsqueda trae una fracción de
 *  los campos, así que se omiten en vez de nulificarlos. Escribir aquí un
 *  `platforms: []` porque la búsqueda no los pidió vaciaría el catálogo de un
 *  juego que ya se había abierto entero. */
export function gameSearchRow(r: Any) {
  const platformNames = platformIndex(r?.platforms);
  return {
    tmdb_id: r.id,
    kind: "game",
    name: r.name ?? "Untitled",
    ...(r.summary !== undefined ? { overview: r.summary ?? null } : {}),
    ...(r.cover?.image_id ? { poster_path: r.cover.image_id } : {}),
    ...(platformNames.size ? { platforms: [...platformNames.values()].sort() } : {}),
    ...(rating10(r) !== null ? { vote_average: rating10(r) } : {}),
  };
}
