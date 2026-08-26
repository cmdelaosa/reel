/* Lo que comparten las dos importaciones de juegos, Steam (0076) y Nintendo
 * (0082): las reglas de qué se escribe y las escrituras en sí.
 *
 * Existe porque lo que cambia entre un proveedor y otro es de dónde salen las
 * filas —OpenID y una Web API key contra un código de amigo y la app de
 * Nintendo—, no qué se hace con ellas. Confirmar un borrador es lo mismo en los
 * dos casos: upsert en `library_entries`, la nota si la hay, el final si lo
 * hay. Duplicar eso habría sido duplicar también sus tres trampas, que son
 * caras y no se ven:
 *
 *   · el upsert agrupado POR JUEGO DE COLUMNAS (ver `writeEntries`),
 *   · el `ignoreDuplicates` con `select` de los finales, que es lo único que
 *     hace que el recibo no mienta,
 *   · y los dos topes de PostgREST, el de mil filas y el de la URL.
 *
 * Las reglas de producto de CADA proveedor no están aquí: viven en su
 * `merge.ts`, con sus pruebas, porque salen de lo que ese proveedor da. Aquí
 * solo lo que es igual mire quien mire.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

/** PostgREST corta en 1.000 filas sin avisar (config.toml → max_rows). Ninguna
 *  consulta pide más que esto de golpe: una lectura truncada en silencio se
 *  leería como "esos juegos no los tienes". */
export const PAGE = 500;

/** El otro tope, que no es de filas sino de CARACTERES: un filtro `in.(…)` de
 *  PostgREST viaja en la query string, y un uuid ocupa 37 bytes con su coma.
 *  500 uuids son 18 KB de URL, muy por encima de los 8 KB que aceptan la
 *  pasarela y Cloudflare — o sea un 414 que se vería como "la importación falla
 *  si marcas muchos juegos", que es justo el caso que hay que aguantar. */
export const ID_PAGE = 100;

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/* ─────────────────────────── Lo que marca la persona ────────────────────── */

const PLAY_STATES = ["backlog", "playing", "ongoing", "dropped"] as const;

/** Lo que la pantalla de confirmar manda por juego, ya limpio.
 *
 *  Llega del navegador, así que aquí no se fía nada: un `state` que no sea uno
 *  de los cinco se queda en null —o sea, "lo tengo y no he dicho nada"— y una
 *  nota que no sea un entero de 1 a 10 no se escribe. Sin esto, un cliente
 *  cualquiera podría meter un play_state que la comprueba de la tabla rechaza y
 *  tirar la importación entera por una fila. */
export interface Pick {
  id: string;
  /** La casilla de la fila en conflicto: ceder ESA fila a las horas de fuera. */
  overwrite: boolean;
  /** Lo que se escribe en `library_entries.play_state`. Null es no tocarlo. */
  playState: "backlog" | "playing" | "ongoing" | "dropped" | null;
  /** Terminado NO es un play_state: es el watch_event (0073). Por eso viaja
   *  aparte y no dentro de `playState`.
   *
   *  Nintendo no lo ofrece —no da la última partida con la que fechar el
   *  evento, ver 0082— pero se parsea igual: lo que decide si se escribe es
   *  quien llama, no el parseo. */
  finished: boolean;
  /** 1..10, o null para no puntuar. */
  rating: number | null;
}

export function parsePick(raw: Any): Pick | null {
  if (typeof raw?.id !== "string" || !raw.id) return null;
  const state = typeof raw?.state === "string" ? raw.state : null;
  /* La nota tiene que llegar como NÚMERO. Un "9" de texto es un cliente roto,
     y aceptarlo con un Number() por medio esconde la avería en vez de que se
     vea el día que aparece. */
  const score = typeof raw?.rating === "number" ? raw.rating : NaN;
  return {
    id: raw.id,
    overwrite: Boolean(raw?.overwrite),
    playState: (PLAY_STATES as readonly string[]).includes(state ?? "")
      ? (state as Pick["playState"])
      : null,
    finished: state === "finished",
    rating: Number.isInteger(score) && score >= 1 && score <= 10 ? score : null,
  };
}

/* ─────────────────────────── Horas tuyas contra horas de fuera ──────────── */

/** El estado de una fila de tu biblioteca frente a lo que dice el proveedor. */
export interface CurrentEntry {
  minutes: number | null | undefined;
  source: string | null | undefined;
}

/** ¿Esta fila es un conflicto — horas tuyas que el proveedor contradice?
 *
 *  Solo lo es si las escribiste TÚ (`minutes_source = 'manual'`), si hay algo
 *  que perder (> 0) y si las cifras difieren. Una fila que ya venía de una
 *  sincronización se reescribe sin preguntar: eso es lo que hace que volver a
 *  sincronizar sirva para algo. */
export function isConflict(
  current: CurrentEntry | null | undefined,
  incomingMinutes: number,
): boolean {
  if (!current) return false;
  const mine = current.minutes ?? 0;
  return current.source === "manual" && mine > 0 && mine !== incomingMinutes;
}

/** Los minutos que hay que escribir, o null para no tocar las horas de la fila.
 *
 *  `overwrite` es la casilla de ESA fila en la pantalla de confirmar, no un
 *  ajuste global: los conflictos son pocos y cada uno tiene su motivo.
 *
 *  Cuando sí escribe, escribe aunque la cifra coincida con la que había. No es
 *  un desperdicio: lo que cambia en ese caso es `minutes_source`, y es lo que
 *  hace que la PRÓXIMA sincronización pueda actualizar esa fila sin volver a
 *  preguntar. Dejarla en 'manual' por casualidad la convertiría en un conflicto
 *  permanente. */
export function minutesToWrite(
  current: CurrentEntry | null | undefined,
  incomingMinutes: number,
  overwrite: boolean,
): number | null {
  if (isConflict(current, incomingMinutes) && !overwrite) return null;
  return incomingMinutes;
}

/* ─────────────────────────── Las escrituras ─────────────────────────────── */

/** Lo que se escribe de un juego en la biblioteca. */
export interface EntryWrite {
  titleId: string;
  minutes: number | null;
  /** Lo que la persona marcó, o null para no tocar `play_state`.
   *
   *  Null es NO TOCARLO y no "quitarlo", y la diferencia importa: un juego que
   *  ya tenías en "Jugando" y que confirmas sin marcarle nada no puede salir de
   *  la importación sin estado. */
  playState: Pick["playState"];
  /** Cuándo se jugó por última vez, cuando el proveedor lo sabe o cuando lo
   *  hemos aprendido (Nintendo, 0082). Null es no tocar `played_at`. */
  playedAt?: string | null;
}

/** Dos filas del borrador que acaban en el MISMO juego del catálogo, en una.
 *
 *  Pasa, y no es raro: con Nintendo el emparejamiento es por nombre, así que
 *  dos entradas del registro con el mismo título —la de Switch y la de Switch
 *  2, una reedición, una versión regional— casan con la misma fila de `titles`.
 *  Con Steam es menos común y también ocurre: dos appids que IGDB ficha como el
 *  mismo juego.
 *
 *  Y no es un detalle cosmético: **Postgres rechaza el lote entero**. Dos filas
 *  con la misma clave dentro de un solo `on conflict do update` dan
 *  `ON CONFLICT DO UPDATE command cannot affect row a second time` (21000), o
 *  sea que una importación de veinte juegos falla del todo porque dos se
 *  llamaban igual. Comprobado contra Postgres, no deducido.
 *
 *  Cómo se funden, y por qué así:
 *
 *    · Los minutos NO se suman. Sumar daría el doble en el caso más probable
 *      —la misma partida listada dos veces— y no hay forma de distinguirlo de
 *      dos ediciones jugadas de verdad. Gana la cifra mayor, que es la que no
 *      es un fragmento.
 *    · Salvo que alguna diga null, y entonces manda el null: null aquí
 *      significa "no toques las horas, son las que escribió a mano", y dejar
 *      que la otra fila las pisara sería saltarse la única regla que estas
 *      importaciones prometen.
 *    · Del estado y la fecha gana el primero que diga algo. Son decisiones de
 *      la persona sobre lo que ella ve como un solo juego; cualquiera de las
 *      dos vale y ninguna se pierde en silencio. */
export function mergeByTitle(rows: EntryWrite[]): EntryWrite[] {
  const byTitle = new Map<string, EntryWrite>();
  for (const r of rows) {
    const seen = byTitle.get(r.titleId);
    if (!seen) {
      byTitle.set(r.titleId, { ...r });
      continue;
    }
    seen.minutes = seen.minutes === null || r.minutes === null
      ? null
      : Math.max(seen.minutes, r.minutes);
    seen.playState = seen.playState ?? r.playState;
    seen.playedAt = seen.playedAt ?? r.playedAt;
  }
  return [...byTitle.values()];
}

/** Escribe en la biblioteca las filas que ya tienen `title_id`.
 *
 *  Un upsert POR JUEGO DE COLUMNAS, y esto no es manía: la lista del
 *  `on conflict do update` de PostgREST sale de la UNIÓN de claves del lote. Si
 *  una fila lleva `minutes_played` y otra no, la que no lo lleva recibe un null
 *  — o sea, borrar las horas que esa persona escribió a mano, que es justo lo
 *  que estas importaciones existen para no hacer.
 *
 *  El criterio es agrupar por QUÉ columnas se escriben, nunca por sus valores.
 */
export async function writeEntries(
  admin: SupabaseClient,
  userId: string,
  rows: EntryWrite[],
  source: "steam" | "nintendo",
): Promise<number> {
  const groups = new Map<string, EntryWrite[]>();
  for (const r of mergeByTitle(rows)) {
    const key = `${r.minutes !== null ? "m" : ""}${r.playState ? "s" : ""}${r.playedAt ? "p" : ""}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  let written = 0;
  for (const [key, part] of groups) {
    const { error } = await admin.from("library_entries").upsert(
      part.map((r) => ({
        user_id: userId,
        title_id: r.titleId,
        followed: true,
        owned: true,
        ...(r.minutes !== null ? { minutes_played: r.minutes, minutes_source: source } : {}),
        ...(r.playState ? { play_state: r.playState } : {}),
        ...(r.playedAt ? { played_at: r.playedAt } : {}),
      })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`library upsert (${key || "owned"}): ${error.message}`);
    written += part.length;
  }

  return written;
}

/** Las notas que la persona puso en la pantalla de confirmar.
 *
 *  Un upsert como el de la ficha (`app/src/lib/ratings.ts`), con la misma clave
 *  única: puntuar dos veces el mismo juego es corregir la nota, no apilar dos.
 *
 *  Y por lo mismo que en `writeEntries`, dos filas del borrador que apunten al
 *  mismo juego se funden ANTES de escribir: con la clave repetida dentro del
 *  lote, Postgres tira el upsert entero con un 21000. Gana la primera nota, que
 *  es la que la persona puso en la fila de arriba. */
export async function writeRatings(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; rating: number }[],
): Promise<number> {
  const byTitle = new Map<string, { titleId: string; rating: number }>();
  for (const r of rows) if (!byTitle.has(r.titleId)) byTitle.set(r.titleId, r);
  rows = [...byTitle.values()];

  if (!rows.length) return 0;
  const now = new Date().toISOString();
  for (const part of chunk(rows, PAGE)) {
    const { error } = await admin.from("ratings").upsert(
      part.map((r) => ({ user_id: userId, title_id: r.titleId, score: r.rating, updated_at: now })),
      { onConflict: "user_id,title_id" },
    );
    if (error) throw new Error(`ratings upsert: ${error.message}`);
  }
  return rows.length;
}

/** Lo marcado como terminado, con la fecha que le corresponda.
 *
 *  Terminado no es un `play_state`: es el `watch_event` del episodio sintético
 *  (0071), que es lo que hace que un juego acabado entre en el historial, en el
 *  muro y en las notas sin que nada de eso sepa que existen los videojuegos.
 *
 *  `ignoreDuplicates`, contra la clave única (user_id, episode_id): si ya lo
 *  tenías terminado, volver a importar NO puede mover la fecha del evento que
 *  ya estaba — esa la pusiste tú. */
export async function writeFinished(
  admin: SupabaseClient,
  userId: string,
  rows: { titleId: string; at: string }[],
  source: "steam" | "nintendo",
): Promise<number> {
  if (!rows.length) return 0;

  // title_id → episodio sintético. El de un juego es siempre el 1x01 (0071).
  const episodeOf = new Map<string, string>();
  for (const part of chunk(rows.map((r) => r.titleId), ID_PAGE)) {
    const { data, error } = await admin
      .from("episodes")
      .select("id, title_id")
      .eq("season_number", 1)
      .eq("episode_number", 1)
      .in("title_id", part);
    if (error) throw new Error(`episodes: ${error.message}`);
    for (const row of data ?? []) episodeOf.set(row.title_id, row.id);
  }

  const events = rows
    .filter((r) => episodeOf.has(r.titleId))
    .map((r) => ({
      user_id: userId,
      episode_id: episodeOf.get(r.titleId)!,
      watched_at: r.at,
      source,
    }));
  if (!events.length) return 0;

  /* El `select` no es decoración: con `ignoreDuplicates` PostgREST devuelve
     solo las filas que ha INSERTADO, así que es la única forma de que el recibo
     diga cuántos finales entraron de verdad. Contar los intentos diría "5
     terminados" cuando tres ya lo estaban desde antes. */
  let written = 0;
  for (const part of chunk(events, PAGE)) {
    const { data, error } = await admin
      .from("watch_events")
      .upsert(part, { onConflict: "user_id,episode_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`watch_events: ${error.message}`);
    written += (data ?? []).length;
  }
  return written;
}
