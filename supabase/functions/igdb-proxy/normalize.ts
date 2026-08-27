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
 * "ya ha salido" (0071). Guardar el PRIMER día del periodo haría que un juego
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

/** Los ocho formatos de `/date_formats`, LEÍDOS DE LA API (24-ago-2026), no de
 *  la documentación.
 *
 *  Importa la distinción: la tabla de enums de api-docs.igdb.com llama a estos
 *  dos `YYYYMMMMDD` y `YYYYMMMM`, con Ms de más. La API devuelve `YYYYMMDD` y
 *  `YYYYMM`. Con los nombres de la documentación puestos, el mapa no acertaba
 *  ni una fecha de día exacto —o sea casi todas— y cada juego salía como
 *  'tbd' y sin fecha. Silksong, con nueve plataformas y salido en septiembre
 *  de 2025, llegaba a la base sin un solo dato de lanzamiento.
 *
 *  Se indexa también por id porque `date_format.id` trae el mismo 0-7 y
 *  sobrevive a que IGDB retoque las etiquetas. */
const BY_FORMAT: Record<string, Precision> = {
  YYYYMMDD: "day",
  YYYYMM: "month",
  YYYY: "year",
  YYYYQ1: "q1",
  YYYYQ2: "q2",
  YYYYQ3: "q3",
  YYYYQ4: "q4",
  TBD: "tbd",
};

const BY_ID: Record<number, Precision> = {
  0: "day",
  1: "month",
  2: "year",
  3: "q1",
  4: "q2",
  5: "q3",
  6: "q4",
  7: "tbd",
};

/** El formato de una fila de release_dates.
 *
 *  La fuente es `date_format`, la referencia a /date_formats. El campo viejo
 *  `category` NO se consulta: IGDB lo marca como deprecado y, comprobado
 *  contra la API, ya no lo devuelve ni aunque se pida — mantener una rama para
 *  él sería una rama que no se ejecuta nunca y que hace creer que hay
 *  respaldo donde no lo hay.
 *
 *  Si no llega el formato, la fila no dice cuánto de su fecha es cierto y no
 *  se la cree: 'tbd'. */
export function precisionOf(row: Any): Precision {
  const text = row?.date_format?.format;
  if (typeof text === "string" && BY_FORMAT[text]) return BY_FORMAT[text];
  const id = row?.date_format?.id;
  if (typeof id === "number" && BY_ID[id]) return BY_ID[id];
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

  // El timestamp se lee SIEMPRE, no solo cuando falta el año: comprobado
  // contra la API, IGDB no manda `d` ni siquiera en las fechas de día exacto
  // —Silksong llega con y=2025, m=9 y sin día—, y el 4 de septiembre está solo
  // aquí. Sin esto, una fecha exacta se degradaba al último día de su mes:
  // veintiséis días de más, y el juego contaba como no salido casi un mes.
  const stamp = typeof row?.date === "number" ? new Date(row.date * 1000) : null;

  const y = typeof row?.y === "number" ? row.y : stamp?.getUTCFullYear() ?? null;
  const m = typeof row?.m === "number" ? row.m : stamp ? stamp.getUTCMonth() + 1 : null;

  if (y === null) return null;

  switch (precision) {
    case "day": {
      // El día solo puede venir del timestamp, y cuando viene de ahí se coge
      // el día ENTERO de ahí. Mezclar el año de la fila con el día del
      // timestamp puede fabricar una fecha que no está en ninguno de los dos:
      // una fila con y=2026 y un timestamp del 31-dic-2025 —que es lo que deja
      // un lanzamiento de fin de año con husos por medio— daría 2026-12-31, un
      // año entero de más.
      if (typeof row?.d === "number" && m !== null) return iso(y, m, row.d);
      if (stamp) {
        return iso(stamp.getUTCFullYear(), stamp.getUTCMonth() + 1, stamp.getUTCDate());
      }
      // Sin día NI timestamp, la fuente se contradice: promete un día exacto
      // y no lo trae. Se degrada al final del mes, que es lo único que queda.
      return m === null ? iso(y, 12, 31) : iso(y, m, lastDayOfMonth(y, m));
    }
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
 *  `platform_releases` (0071).
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

/** El término de búsqueda, listo para meter entre comillas en una consulta
 *  apicalypse.
 *
 *  La barra invertida PRIMERO y la comilla después, en ese orden: al revés, la
 *  barra que acabamos de escribir delante de la comilla se volvería a escapar
 *  y el resultado sería `\\"`, que cierra la cadena. Buscar `\` (o cualquier
 *  cosa que lo lleve, como una ruta pegada) dejaba la consulta sin terminar y
 *  IGDB devolvía un 400 que el proxy traducía a un 502 — un error de servidor
 *  por un carácter que alguien tecleó en un buscador.
 *
 *  Los saltos de línea se van con ellos: apicalypse termina las sentencias con
 *  `;` y una cadena multilínea no rompe nada hoy, pero no hay ninguna búsqueda
 *  real que los necesite. */
export function apicalypseTerm(q: string): string {
  return q
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .trim();
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

/** El appid de Steam, para la sincronización que llega más tarde (0071).
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

/** Las plataformas que Steam vende, en minúsculas y como las nombra IGDB.
 *
 *  Steam es una tienda de ordenador: lo que vende corre en Windows, en Mac, en
 *  Linux o en su propio SteamOS. No hay un juego de Steam que sea solo de
 *  Nintendo DS, y esa imposibilidad es justo la comprobación que faltaba.
 *
 *  `DOS` está en la lista y no es un descuido: Steam vende cientos de juegos de
 *  los noventa —el Doom del 93, los Monkey Island— envueltos en DOSBox, y para
 *  IGDB la plataforma de aquello es "DOS" a secas. Sin esta línea, la
 *  comprobación se llevaría por delante justo los juegos viejos de una
 *  biblioteca vieja. */
const STEAM_PLATFORMS = [
  "pc (microsoft windows)",
  "mac",
  "linux",
  "steamos",
  // `SteamVR`, sin espacio: es como lo escribe IGDB, comprobado contra las
  // fichas del catálogo (27-ago-2026). Con "steam vr" esta línea no casaba con
  // nada, y como Half-Life: Alyx y compañía no tienen más plataforma que esa,
  // la comprobación les habría borrado el appid al primer refresco — es decir,
  // se habría llevado por delante justo los juegos que SOLO existen en Steam.
  "steamvr",
  "dos",
  "pc dos",
];

/** ¿Puede este juego estar en Steam, a la vista de sus plataformas?
 *
 *  **Solo para desempatar, nunca para vetar**, y esa distinción está pagada:
 *  nació como veto —si las plataformas no son de ordenador, fuera el appid— y
 *  duró unas horas. Lo que lo tumbó fue Maui Mallard in Cold Shadow, que se
 *  vende en Steam y en IGDB es un juego de Super Nintendo del 96: las
 *  reediciones cuelgan de la ficha ORIGINAL, así que "plataformas de consola"
 *  no significa "no está en Steam". El veto le habría borrado el appid a los
 *  clásicos reeditados, que son justo los que más cuesta volver a encontrar.
 *
 *  Lo que sí sirve es elegir cuando IGDB da DOS juegos para el mismo appid: a
 *  igualdad de todo lo demás, el que puede estar en Steam es mejor candidato
 *  que el que no. Si el candidato es único se acepta tal cual, aunque sea de
 *  consola — puede ser una reedición, y perder el juego es peor que casarlo
 *  raro.
 *
 *  Sin plataformas es que SÍ: una ficha recién creada o un resultado de
 *  búsqueda no las traen, y "no lo sabemos" no es "no". Un juego sin salir,
 *  igual: tiene la lista a medias por definición. */
export function couldBeOnSteam(
  platforms: readonly string[] | null | undefined,
  releaseDate?: string | null,
  now = new Date(),
): boolean {
  if (!platforms?.length) return true;
  if (platforms.some((p) => STEAM_PLATFORMS.includes(String(p).toLowerCase()))) return true;
  if (!releaseDate) return true;
  const released = Date.parse(releaseDate);
  return !Number.isFinite(released) || released > now.getTime();
}

/** Las tres medias de IGDB para terminarse un juego, en segundos.
 *
 *  Devuelve undefined —no {}— cuando no hay ninguna, para que un upsert que no
 *  pidió estos datos no vacíe lo que otro ya escribió. Es la misma regla que
 *  `providerMap` en tmdb-proxy, y por el mismo motivo: quien no lo pidió no
 *  puede borrarlo. */
export function beatSeconds(ttb: Any): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  /* `count` viaja con las tres cifras y no es un extra: es DE CUÁNTA GENTE
     salen. Sin él, tres números redondos se leen como un hecho, y aquí son a
     veces veintiocho estimaciones — que es además el motivo de que el «al
     100 %» llegue a veces disparatado. La ficha lo enseña en letra pequeña. */
  for (const key of ["hastily", "normally", "completely", "count"] as const) {
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
/** `steam` son las dos notas de la tienda, ya normalizadas, o null si el juego
 *  no está en Steam o la tienda no contestó. Se pasa en vez de leerse aquí
 *  porque esto es una traducción pura y aquello es una petición de red — y
 *  además llega de OTRA fuente, así que confundirlas haría que un mal minuto
 *  de Steam borrara media ficha de IGDB.
 *
 *  Cuando es null las dos columnas NO viajan en el upsert: la ficha conserva lo
 *  que se guardó la última vez que la tienda sí contestó, en vez de quedarse
 *  sin notas por un fallo pasajero. */
export function gameRow(d: Any, ttb: Any = null, steam: SteamNotas | null = null) {
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
    // /t_{size}/{hash}.jpg, y el tamaño lo elige quien pinta (ver 0071).
    poster_path: d.cover?.image_id ?? null,
    backdrop_path: d.artworks?.[0]?.image_id ?? d.screenshots?.[0]?.image_id ?? null,
    first_air_date: canonical.date,
    release_precision: canonical.precision,
    status: d.game_status?.status ?? null,
    genres: (d.genres ?? []).map((g: Any) => g.name).filter(Boolean),
    platforms: [...platformNames.values()].sort(),
    platform_releases: byPlatform,
    network: studio(d.involved_companies),
    // La otra mitad de `involved_companies`, que se leía a medias.
    publisher: distribuidora(d.involved_companies),
    game_modes: (d.game_modes ?? []).map((m: Any) => m?.name).filter(Boolean),
    vote_average: rating10(d),
    // `hypes` es el número de seguidores ANTES de salir y es lo único que IGDB
    // da para un juego sin lanzar; después manda el número de votos. Sumarlos
    // deja una sola columna que ordena las dos épocas sin ramas.
    popularity: (d.hypes ?? 0) + (d.total_rating_count ?? 0),
    ...(beats ? { beat_seconds: beats } : {}),
    /* El que IGDB diga, sin filtrarlo por las plataformas del juego. Se probó
       lo contrario durante unas horas y estaba mal: **una reedición cuelga de
       la ficha original**. Maui Mallard in Cold Shadow se vende en Steam
       (appid 987410) y en IGDB es un juego de Super Nintendo del 96, porque su
       lista de plataformas es la del lanzamiento de entonces. Filtrando, se le
       borraba el appid a los clásicos reeditados —justo los que más cuesta
       volver a casar— para atrapar un vínculo roto que, encima, no se
       distingue de este por ningún dato que tengamos. Ver `couldBeOnSteam`,
       que sigue existiendo para lo único que sí sabe hacer: desempatar. */
    steam_appid: steamAppid(d.external_games),
    /* La ficha ampliada (0086). Las cuatro van siempre, con su null cuando el
       juego no las tiene: son de este payload y solo las escribe el detalle,
       así que un null aquí significa "IGDB no tiene", no "no preguntamos".
       Ojo con imitarlo en gameSearchRow: allí la búsqueda NO pide estos campos
       y escribirlos borraría lo que el detalle guardó. */
    screenshots: capturasRecortadas(d.screenshots),
    videos: videosRecortados(d.videos),
    age_ratings: edades(d.age_ratings),
    official_url: webOficial(d.websites),
    ...(steam ?? {}),
    last_refreshed_at: new Date().toISOString(),
  };
}

/** Fila parcial para los resultados de búsqueda.
 *
 *  ── Por qué TODAS las claves van siempre, incluso en null ─────────────────
 *  La tentación es omitir el campo que no viene, para no pisar lo que un
 *  detalle completo ya escribió. Con un upsert de UNA fila funcionaría; con el
 *  de un LOTE, no: PostgREST construye una sola lista de columnas con la unión
 *  de las claves de todas las filas, y la fila que omitió una recibe un NULL
 *  explícito, no el default de la columna.
 *
 *  Eso reventaba la búsqueda entera en cuanto un resultado no traía
 *  plataformas: `titles.platforms` es NOT NULL DEFAULT '{}' (0071), el lote
 *  metía NULL, y el 502 resultante se leía en la interfaz como "no hay
 *  resultados". Buscar "mario kart" funcionaba y "mari" no, según lo que
 *  tuviera el peor resultado del lote.
 *
 *  Escribir el null tampoco pierde nada, y esto es lo que hace que la solución
 *  sea correcta y no un parche: la búsqueda PIDE estos mismos campos, así que
 *  que falten significa que el juego no los tiene. Lo que un detalle escribe y
 *  la búsqueda no —fechas, beat_seconds, plataformas por fecha, estudio,
 *  géneros, steam_appid— no está en esta fila NI EN NINGUNA del lote, así que
 *  PostgREST no incluye esas columnas y quedan intactas. */
export function gameSearchRow(r: Any) {
  const platformNames = platformIndex(r?.platforms);
  return {
    tmdb_id: r.id,
    kind: "game",
    name: r.name ?? "Untitled",
    overview: r.summary ?? null,
    poster_path: r.cover?.image_id ?? null,
    platforms: [...platformNames.values()].sort(),
    vote_average: rating10(r),
    // La búsqueda ya trae las dos señales porque rankSearch las necesita, así
    // que se guardan de paso: un juego que solo se ha visto en un buscador
    // llega a la biblioteca con su popularidad puesta, sin abrir la ficha.
    popularity: (r?.hypes ?? 0) + (r?.total_rating_count ?? 0),
  };
}

/** La distribuidora, que es la otra mitad de `involved_companies`.
 *
 *  `studio` de arriba se queda con el desarrollador y cae al primero que haya
 *  si nadie está marcado; aquí NO se hace esa concesión. Un juego sin editora
 *  marcada es un juego autodistribuido o mal fichado, y en los dos casos
 *  inventarle una —la primera empresa de la lista, que puede ser el estudio de
 *  soporte que hizo el port— sería peor que dejar la línea sin poner. */
export function distribuidora(involved: readonly Any[] | null | undefined): string | null {
  const pub = (involved ?? []).find((c) => c?.publisher)?.company?.name;
  return typeof pub === "string" && pub ? pub : null;
}

/* ─────────────────── La ficha ampliada del juego (0086) ───────────────────
 *
 * Cuatro listas que IGDB manda largas y aquí se recortan a lo que la ficha
 * pinta. El motivo es el tamaño, no el gusto: esta fila viaja en la rejilla de
 * la biblioteca y en el muro, y `videos` llega con nueve entradas y
 * `screenshots` con dieciséis.
 *
 * Todas devuelven null cuando no hay nada, nunca [] — igual que en 0087. Null
 * es "este juego no tiene", que la ficha lee como "no pintes esa sección";
 * una lista vacía se pintaría como una sección con un hueco dentro. */

/* El orden de los vídeos, que es toda la decisión: la ficha pinta UNO.
 *
 * El del payload no sirve — IGDB los devuelve como se subieron, así que el
 * primero suele ser el teaser del anuncio, de años antes de salir.
 *
 * Va primero el de lanzamiento, porque enseña el juego que se vende hoy y no
 * el que se prometió; después gameplay, porque para decidir si te lo pones
 * importa más ver cómo se juega que un corto cinemático; después cualquier
 * otro tráiler; y al final lo que no lo es (diarios de desarrollo, etc.). */
const RANGO_VIDEO = (nombre: string): number => {
  const n = nombre.toLowerCase();
  if (n.includes("launch")) return 0;
  if (n.includes("gameplay")) return 1;
  if (n.includes("trailer")) return 2;
  return 3;
};

/** Los vídeos, con el mejor tráiler primero. Cuatro y no uno: cuestan cuarenta
 *  bytes cada uno y ahorran un refresco entero el día que la ficha quiera
 *  ofrecer "ver más vídeos". */
export function videosRecortados(
  videos: readonly Any[] | null | undefined,
): { name: string; video_id: string }[] | null {
  const out = (videos ?? [])
    .filter((v) => typeof v?.video_id === "string" && v.video_id)
    .map((v) => ({
      name: typeof v?.name === "string" && v.name ? v.name : "Trailer",
      video_id: v.video_id as string,
    }));
  // Ordenación ESTABLE: dentro del mismo rango se respeta el orden de IGDB, que
  // es cronológico de subida. Entre dos tráileres de lanzamiento gana el que
  // subieron antes, que es el del lanzamiento de verdad y no el del port.
  out.sort((a, b) => RANGO_VIDEO(a.name) - RANGO_VIDEO(b.name));
  return out.length ? out.slice(0, 4) : null;
}

/** Los hashes de las capturas. Ocho: la ficha enseña cinco y el resto es
 *  margen para que el carrusel no se quede corto en un juego con pocas. */
export function capturasRecortadas(shots: readonly Any[] | null | undefined): string[] | null {
  const out = (shots ?? [])
    .map((s) => s?.image_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id))
    .slice(0, 8);
  return out.length ? out : null;
}

/* Los dos enums de clasificación por edad, LEÍDOS DE LA API (27-ago-2026) y no
   de la documentación, por lo mismo que los formatos de fecha de más arriba: la
   tabla publicada y lo que responde el servidor no siempre coinciden.

   `rating_category` es único en toda la tabla de IGDB, no por organismo, así
   que un solo mapa basta y no hay que cruzar los dos. */
const ORGANISMO: Record<number, string> = {
  1: "ESRB",
  2: "PEGI",
  3: "CERO",
  4: "USK",
  5: "GRAC",
  6: "CLASS_IND",
  7: "ACB",
};

const CATEGORIA: Record<number, string> = {
  1: "RP", 2: "EC", 3: "E", 4: "E10+", 5: "T", 6: "M", 7: "AO",
  8: "3", 9: "7", 10: "12", 11: "16", 12: "18",
  13: "A", 14: "B", 15: "C", 16: "D", 17: "Z",
  18: "0", 19: "6", 20: "12", 21: "16", 22: "18",
  23: "ALL", 24: "12+", 25: "15+", 26: "19+",
  28: "L", 29: "10", 30: "12", 31: "14", 32: "16", 33: "18",
  34: "G", 35: "PG", 36: "M", 37: "MA 15+", 38: "R 18+", 39: "RC", 40: "18+",
};

/** Las clasificaciones por edad, con los nombres ya resueltos.
 *
 *  Se guardan TODAS las que IGDB dé y no solo la europea: quien pinta elige
 *  —hoy PEGI, con ESRB de respaldo— y esa preferencia es de interfaz, no un
 *  dato. Un juego clasificado solo en Japón se quedaría sin edad si el filtro
 *  se hiciera aquí.
 *
 *  La fila a la que le falte organismo o categoría se descarta: "PEGI" sin
 *  número, o un número sin saber de quién, no se puede pintar. */
export function edades(
  ratings: readonly Any[] | null | undefined,
): { org: string; rating: string }[] | null {
  const out: { org: string; rating: string }[] = [];
  for (const r of ratings ?? []) {
    const org = ORGANISMO[r?.organization];
    const rating = CATEGORIA[r?.rating_category];
    if (org && rating) out.push({ org, rating });
  }
  return out.length ? out : null;
}

/** La web oficial del juego, que es el respaldo del enlace a Steam.
 *
 *  Tipo 1 de `websites`. Con preferencia por las que IGDB marca `trusted`: la
 *  lista la edita la comunidad y un juego viejo arrastra a veces un dominio
 *  caducado que hoy es otra cosa. Entre dos de confianza, la primera. */
export function webOficial(sites: readonly Any[] | null | undefined): string | null {
  const oficiales = (sites ?? []).filter(
    (w) => w?.type === 1 && typeof w?.url === "string" && w.url,
  );
  const elegida = oficiales.find((w) => w?.trusted) ?? oficiales[0];
  return elegida?.url ?? null;
}

/* ─────────────────────────── Lo que dice Steam ────────────────────────────
 *
 * Dos rutas públicas de la tienda, sin clave. Se piden solo cuando el juego
 * tiene `steam_appid`, y lo que devuelven se normaliza aquí para que index.ts
 * no tenga que saber cómo es de rara la respuesta de appdetails.
 *
 * Las dos son tolerantes: un juego retirado de la tienda, o una respuesta a
 * medias, devuelve null y la ficha simplemente no enseña esa nota. */

/** El porcentaje de reseñas positivas y cuántas hay.
 *
 *  Se guarda el porcentaje CALCULADO de positivas y negativas, no el
 *  `review_score` de Steam (un 0-9 propio suyo) ni su `review_score_desc`: el
 *  primero no significa nada fuera de Steam y el segundo es texto de interfaz
 *  en el idioma que la tienda respondiera ese día. La etiqueta la pone el
 *  cliente, en el idioma de quien mira. */
/* Las dos notas de la tienda. OPCIONALES las dos, y eso es el contrato: una
   clave ausente significa "esa petición no contestó, no toques la columna",
   mientras que un null significa "contestó y no hay nota". Son dos peticiones
   distintas, así que lo normal es que falle una sola. */
export interface SteamNotas {
  steam_reviews?: { percent: number; count: number } | null;
  metacritic?: number | null;
}

export function steamReviews(q: Any): { percent: number; count: number } | null {
  const pos = q?.total_positive;
  const total = q?.total_reviews;
  if (typeof pos !== "number" || typeof total !== "number" || total <= 0) return null;
  return { percent: Math.round((pos / total) * 100), count: total };
}

/** La nota de la crítica que Steam ya trae dentro de appdetails.
 *
 *  Solo 0-100: un `score` fuera de ese rango es la tienda diciendo algo que no
 *  entendemos, y pintarlo sería peor que no pintarlo. */
export function metacritic(data: Any): number | null {
  const score = data?.metacritic?.score;
  return typeof score === "number" && score >= 0 && score <= 100 ? score : null;
}
