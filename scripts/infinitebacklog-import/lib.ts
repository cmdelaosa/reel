/* Las reglas de la importación de InfiniteBacklog, separadas de la red y de la
 * base para poder probarlas. El CLI que las usa está en ./index.ts.
 *
 * InfiniteBacklog exporta tres CSV —colección, listas y deseados— y trae el id
 * de IGDB en cada fila. Eso es lo que hace que esta importación no se parezca a
 * la de TV Time: allí había que casar TVDB con TMDB juego a juego y la mitad del
 * trabajo era el emparejamiento. Aquí el id es el MISMO espacio de ids que
 * `titles.tmdb_id` para kind='game' (ver la migración 0071), así que resolver un
 * juego es pedirle su ficha a igdb-proxy y ya.
 *
 * ── Lo que el CSV dice y lo que Reel guarda ──────────────────────────────
 * InfiniteBacklog separa `Status` (Played / Playing) de `Completion`
 * (Completed / Beaten / Continuous / Dropped / Unfinished / Not Started / No
 * Status). Reel tiene un `play_state` de cuatro valores y "Terminado", que NO
 * es un estado sino el watch_event del episodio sintético (0073, gameStatus.ts).
 * La traducción entera está en `progressOf`, con su tabla.
 *
 * ── Las fechas del CSV mandan, y no es un detalle ────────────────────────
 * Todo lo que se escribe va fechado con lo que dice el export —`Date added`
 * para la biblioteca, `Last updated` para lo terminado y para las notas— y no
 * con el día de la importación. Dos razones, y la segunda es la que obliga:
 *
 *   1. Es la verdad: esos juegos se terminaron en 2024, no esta tarde.
 *   2. El muro de los amigos es una VISTA de esas tres marcas de tiempo
 *      (0077), no una tabla de eventos. Con fecha de hoy, 188 notas y 162
 *      juegos terminados se comerían el cupo por persona de
 *      `rpc_friend_activity` y la actividad de series y cine de quien importa
 *      desaparecería del muro. Lo añadido lo pliega 0077 en una sola frase; las
 *      NOTAS no las pliega nadie, así que fecharlas hoy publicaría 188 filas
 *      idénticas.
 *
 * ── Lo que no se pisa ────────────────────────────────────────────────────
 * Esta cuenta ya tiene juegos (la importación de Steam del 24-ago-2026, entre
 * otros), así que esto FUNDE, no reemplaza: una nota que ya existe, un estado ya
 * dicho o unas horas escritas a mano que no coincidan se dejan como están y se
 * cuentan aparte. Es la regla 2 de steam-sync/merge.ts, y por lo mismo — una
 * cifra que corregiste a mano no la corrige un CSV de hace ocho meses.
 */

export type PlayState = "backlog" | "playing" | "ongoing" | "dropped";

/** Una fila de CSV, ya con sus columnas por nombre. */
export type Row = Record<string, string>;

/* ──────────────────────────── El CSV ────────────────────────────────────── */

/** Parser de CSV con comillas, comas dentro del campo y comillas escapadas
 *  (`""`). No vale un `split(",")`: hay nombres de esta colección con coma
 *  —«If on a Winter's Night, Four Travelers»— y partirlos por ahí desplaza
 *  TODAS las columnas de esa fila, así que el juego entraría con la plataforma
 *  en el estado y el estado en las horas. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  // El BOM que ponen Excel y compañía se come el nombre de la primera columna
  // —"﻿IGDB ID" no es "IGDB ID"— y el fallo se ve como un export sin ids.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (c !== "\r") {
        // Igual que fuera de las comillas: un fichero CRLF con un campo de
        // varias líneas —una nota larga— dejaría un \r pegado al final de cada
        // una, y eso viaja hasta la base.
        field += c;
      }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { record.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { record.push(field); rows.push(record); record = []; field = ""; continue; }
    field += c;
  }
  // La última fila sin salto final también cuenta.
  if (field.length || record.length) { record.push(field); rows.push(record); }

  const header = rows.shift();
  if (!header) return [];
  const out: Row[] = [];
  for (const r of rows) {
    // Una línea en blanco al final no es una fila: sin esto, el export de
    // deseados —que es solo la cabecera— devolvería un juego fantasma.
    if (r.length === 1 && !r[0].trim()) continue;
    const o: Row = {};
    header.forEach((h, i) => { o[h.trim()] = (r[i] ?? "").trim(); });
    out.push(o);
  }
  return out;
}

/* ───────────────────────── Las reglas de producto ───────────────────────── */

export interface Progress {
  /** Lo que se escribe en `library_entries.play_state`. Null es "no ha dicho
   *  nada", que la derivación convierte en Pendiente o en Lo tengo según las
   *  horas (gameStatus.ts). */
  playState: PlayState | null;
  /** Terminado no es un play_state: es el watch_event del episodio sintético. */
  finished: boolean;
}

/** De (Status, Completion) de InfiniteBacklog al estado de Reel.
 *
 *    Completion    Status     →  Reel
 *    ─────────────────────────────────────────────────────────────────────
 *    Completed     *             terminado (watch_event), sin play_state
 *    Beaten        *             terminado — «me salieron los créditos», que es
 *                                exactamente lo que el watch_event significa
 *    Continuous    *             'ongoing' — el CS, el LoL: no se acaban
 *    Dropped       *             'dropped'
 *    Unfinished    Playing       'playing'
 *    Unfinished    Played / —    null → Pendiente, porque hay horas
 *    Not Started   *             null → Lo tengo (0 h y es tuyo)
 *    No Status     *             null
 *
 *  La fila que más se piensa es `Unfinished` + `Played`: son juegos que
 *  empezaste y no estás jugando ahora. Marcarlos 'playing' llenaría "Jugando"
 *  de cosas que tocaste en 2016 —el mismo error del que la importación de Steam
 *  se cuida (merge.ts, regla 1)— y marcarlos 'dropped' sería decir que los
 *  abandonaste, que el CSV no dice. Null los deja en Pendientes en cuanto
 *  tengan horas, que es lo que son: empezados y sin terminar. */
export function progressOf(status: string, completion: string): Progress {
  const c = (completion ?? "").trim().toLowerCase();
  if (c === "completed" || c === "beaten") return { playState: null, finished: true };
  if (c === "continuous") return { playState: "ongoing", finished: false };
  if (c === "dropped") return { playState: "dropped", finished: false };
  if (c === "unfinished" && (status ?? "").trim().toLowerCase() === "playing") {
    return { playState: "playing", finished: false };
  }
  return { playState: null, finished: false };
}

/** Los minutos de la columna `Playtime`, que ya viene en minutos.
 *
 *  Vacío y 0 son lo mismo aquí —`minutes_played` es not null con default 0 desde
 *  0073— y cualquier cosa que no sea un entero positivo se descarta en vez de
 *  colarse como NaN, que la base rechazaría tirando el lote entero. */
export function minutesOf(playtime: string): number {
  const n = Number((playtime ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** La nota, 1..10, o null.
 *
 *  `ratings.score` tiene `check (score between 1 and 10)`, así que un 0 —que en
 *  InfiniteBacklog es "sin nota"— no es una nota baja: es la ausencia de nota, y
 *  escribirlo reventaría la fila. */
export function ratingOf(raw: string): number | null {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** Una fecha del export como ISO, o null.
 *
 *  Vienen ya en ISO con Z (`2024-12-21T14:12:07.000Z`), pero se normaliza igual:
 *  una celda vacía o una fecha imposible tienen que salir como null y no como
 *  "Invalid Date", que PostgREST acepta como texto y Postgres rechaza. Lo que
 *  cae en el futuro se descarta por lo mismo que en steam-sync/merge.ts: un
 *  evento por delante de hoy no lo enseña ninguna lista y nadie lo puede
 *  corregir. */
export function isoOf(raw: string, now = Date.now()): string | null {
  const t = Date.parse((raw ?? "").trim());
  if (!Number.isFinite(t)) return null;
  if (t > now + 24 * 60 * 60 * 1000) return null;
  return new Date(t).toISOString();
}

/* ─────────────────────────── El plan ────────────────────────────────────── */

export interface PlannedGame {
  igdbId: number;
  name: string;
  /** De la colección (lo tienes) o solo de una lista (lo quieres). */
  from: "collection" | "list";
  /** `library_entries.owned`. Solo lo de la colección con Ownership = Owned. */
  owned: boolean;
  minutes: number;
  playState: PlayState | null;
  finished: boolean;
  /** Con qué fecha se escribe el watch_event de lo terminado. */
  finishedAt: string | null;
  rating: number | null;
  ratedAt: string | null;
  addedAt: string | null;
  /** `library_entries.played_at`: la última vez que consta que lo tocaste. */
  playedAt: string | null;
}

export interface Plan {
  games: PlannedGame[];
  /** Filas del export que no entran, contadas. Callarlas sería enseñar
   *  "importados 386" habiendo entrado menos. */
  skipped: string[];
}

const LIST_STATE: PlayState = "backlog";

/** El plan completo a partir de los tres CSV.
 *
 *  La colección MANDA sobre las listas: hay juegos que están en las dos, y son
 *  juegos que tienes Y que te has propuesto (re)jugar. Bajar un "Terminado" a
 *  "Pendiente" porque además esté en «Want to play» sería perder el dato bueno;
 *  al revés no se pierde nada.
 *
 *  Todo lo que sale de una lista entra como 'backlog' EXPLÍCITO y no como null.
 *  Null sería "no he dicho nada", y estar en «Want to play» es justo haberlo
 *  dicho — es la distinción que 0078 abrió para la importación de Steam. */
export function buildPlan(collectionCsv: string, listsCsv: string, wishlistCsv: string): Plan {
  const games = new Map<number, PlannedGame>();
  const skipped: string[] = [];

  for (const r of parseCsv(collectionCsv)) {
    const igdbId = Number(r["IGDB ID"]);
    if (!Number.isInteger(igdbId) || igdbId < 1) {
      skipped.push(`colección: fila sin id de IGDB (${r["Game name"] || "sin nombre"})`);
      continue;
    }
    const { playState, finished } = progressOf(r["Status"] ?? "", r["Completion"] ?? "");
    const updated = isoOf(r["Last updated"] ?? "");
    games.set(igdbId, {
      igdbId,
      name: r["Game name"] ?? String(igdbId),
      from: "collection",
      owned: (r["Ownership"] ?? "").trim().toLowerCase() === "owned",
      minutes: minutesOf(r["Playtime"] ?? ""),
      playState,
      finished,
      finishedAt: updated,
      rating: ratingOf(r["Rating (Score)"] ?? ""),
      ratedAt: updated,
      addedAt: isoOf(r["Date added"] ?? ""),
      playedAt: updated,
    });
  }

  const fromList = (r: Row, source: string) => {
    const igdbId = Number(r["IGDB ID"]);
    if (!Number.isInteger(igdbId) || igdbId < 1) {
      skipped.push(`${source}: fila sin id de IGDB (${r["Game name"] || "sin nombre"})`);
      return;
    }
    if (games.has(igdbId)) return;   // la colección manda
    games.set(igdbId, {
      igdbId,
      name: r["Game name"] ?? String(igdbId),
      from: "list",
      owned: false,
      minutes: 0,
      playState: LIST_STATE,
      finished: false,
      finishedAt: null,
      rating: null,
      ratedAt: null,
      addedAt: isoOf(r["Date added"] ?? ""),
      playedAt: null,
    });
  };

  for (const r of parseCsv(listsCsv)) fromList(r, "listas");
  // Los deseados son lo mismo que una lista: querer jugarlo. Este export vino
  // vacío, y aun así se lee — un importador que ignora un fichero porque hoy
  // está vacío es un importador que miente el día que no lo esté.
  for (const r of parseCsv(wishlistCsv)) fromList(r, "deseados");

  return { games: [...games.values()], skipped };
}

/* ─────────────────── Fundir con lo que ya hay en la cuenta ──────────────── */

/** La fila que ya existe en `library_entries`, en lo que a esto le importa. */
export interface CurrentEntry {
  /** false es "lo quitaste de la biblioteca" (library.ts no borra la fila, la
   *  marca), y por eso hay que leerlo: es una decisión tuya, no un hueco. */
  followed: boolean | null;
  play_state: string | null;
  minutes_played: number | null;
  minutes_source: string | null;
  owned: boolean | null;
  added_at: string | null;
}

export interface EntryDecision {
  /** Lo que se manda al upsert. */
  patch: Record<string, unknown>;
  /** Lo que el CSV decía y no se escribe, para contarlo. */
  conflicts: string[];
}

/** Qué se escribe de un juego que YA está en la biblioteca.
 *
 *  Rellenar huecos, nunca pisar:
 *
 *    · `play_state` ya dicho se respeta. Lo que dijiste en la app la semana
 *      pasada gana a un CSV exportado de un estado de hace ocho meses.
 *    · las horas se escriben si la fila no tiene ninguna, o si las que tiene
 *      vienen de Steam y el CSV dice más (el CSV incluye consola y móvil, que
 *      Steam no puede ver). Unas horas 'manual' distintas NO se tocan: es la
 *      regla 2 de steam-sync/merge.ts.
 *    · `owned` solo sube de false a true: tener algo no se deja de tener porque
 *      un export no lo mencione.
 *    · `added_at` se queda con la MÁS ANTIGUA. Es la fecha que ordena la
 *      biblioteca y la que publica el muro; adelantarla al día de hoy sería
 *      republicar como nuevo algo que llevas un año teniendo.
 *    · lo que QUITASTE de la biblioteca sigue quitado. `followed` solo se
 *      escribe al dar de alta; una fila con `followed = false` es una decisión
 *      tuya (library.ts marca, no borra), y volver a seguirla porque un CSV la
 *      mencione es exactamente pisar. Se cuenta en el informe para que se vea.
 *
 *  Ese último no estaba dicho y el código lo hacía a medias: `followed: true`
 *  iba en el parche pero el que llama solo lo mandaba si ADEMÁS había otra
 *  columna que cambiar, así que un juego que habías quitado volvía o no volvía
 *  según si de paso se le escribían horas. Cualquiera de las dos respuestas es
 *  defendible; que dependa de eso, no. */
export function decideEntry(
  planned: PlannedGame,
  current: CurrentEntry | null,
): EntryDecision {
  const conflicts: string[] = [];
  const patch: Record<string, unknown> = {};

  if (!current) {
    patch.followed = true;
    patch.owned = planned.owned;
    patch.play_state = planned.playState;
    patch.minutes_played = planned.minutes;
    if (planned.minutes > 0) patch.minutes_source = "manual";
    if (planned.addedAt) patch.added_at = planned.addedAt;
    return { patch, conflicts };
  }

  if (current.followed === false) {
    conflicts.push(`${planned.name}: lo quitaste de la biblioteca; el CSV lo trae y se queda fuera`);
  }

  if (planned.owned && !current.owned) patch.owned = true;

  if (planned.playState && !current.play_state) patch.play_state = planned.playState;
  else if (planned.playState && current.play_state && current.play_state !== planned.playState) {
    conflicts.push(
      `${planned.name}: estado ya dicho '${current.play_state}', el CSV dice '${planned.playState}'`,
    );
  }

  const mine = current.minutes_played ?? 0;
  if (planned.minutes > 0) {
    if (mine === 0 || (current.minutes_source === "steam" && planned.minutes > mine)) {
      patch.minutes_played = planned.minutes;
      patch.minutes_source = "manual";
    } else if (mine !== planned.minutes) {
      conflicts.push(
        `${planned.name}: ${mine} min en la cuenta (${current.minutes_source ?? "sin fuente"}), ` +
          `${planned.minutes} min en el CSV`,
      );
    }
  }

  const olderAdd = [current.added_at, planned.addedAt]
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).toISOString())
    .sort()[0];
  if (olderAdd && current.added_at && olderAdd !== new Date(current.added_at).toISOString()) {
    patch.added_at = olderAdd;
  }

  return { patch, conflicts };
}
