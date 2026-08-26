/* El muro de un perfil: qué ha hecho esta persona, en los tres medios y en una
   sola lista. Puro, con pruebas al lado (activityWall.test.ts).

   No lo sirve `rpc_friend_activity` —el muro del GRUPO, que reparte su cupo
   entre todos y del que un perfil solo rescataría cuatro filas— sino los mismos
   datos que el perfil ya lee para todo lo demás: lo visto, lo puntuado y lo
   añadido. Lo que este módulo aporta es lo que allí hace el SQL de 0077 y aquí
   no hacía nadie: PLEGAR.

   Y plegar no es cosmética. Sin ello, la importación de InfiniteBacklog (386
   juegos) o la de FilmAffinity (1.325 películas) son 386 y 1.325 filas idénticas
   en el muro, y la actividad real de esa persona queda enterrada bajo una tarde
   de agosto. Las mismas dos reglas que el muro del grupo, escritas una vez:

     · lo visto se pliega por (título, día): "vio S1·E3–E7 de Severance".
     · lo añadido se pliega por (medio, lista, día): "añadió 386 juegos a su
       biblioteca". Y el MEDIO entra en la clave además de la lista porque
       series y cine comparten watchlist — sin él, tres series y dos pelis del
       mismo día salen como "cinco series".
     · lo puntuado no se pliega: cada nota es una decisión suya.

   El día es el LOCAL de quien mira, no Europe/Madrid como en el RPC. Aquí no
   hay más remedio y además es lo correcto: es tu perfil en tu pantalla, y "lo
   de ayer" quiere decir tu ayer. */

import { addedList, type AddedList, type Medium } from "@/domain/mediumCopy";

/** Un episodio visto. En cine y en juegos es el episodio sintético de 0067 y
 *  0071 —S1E1— y sus números no se pintan nunca; llegan porque la fila los
 *  trae, no porque nadie los quiera. */
export interface WatchEvent {
  at: string;
  kind: Medium;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  season_number: number;
  episode_number: number;
}

export interface RatingEvent {
  at: string;
  kind: Medium;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  score: number;
}

export interface AddedEvent {
  at: string;
  kind: Medium;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  /** "Lo tengo" (0076). Saca la fila de Pendientes y la manda a la BIBLIOTECA,
   *  que es lo que pasa con todo lo que entra por Steam. */
  owned?: boolean | null;
}

export type Verb = "watched" | "rated" | "added";

/** Un episodio, por su número de temporada y el suyo. */
export interface EpisodeRef {
  season: number;
  episode: number;
}

export interface WallItem {
  /** Estable entre renders con los mismos datos: es la `key` de React y el
   *  ancla de cualquier cosa que un día quiera señalar una fila. */
  key: string;
  verb: Verb;
  kind: Medium;
  at: string;
  /** El título, o el REPRESENTANTE del grupo: el más reciente del día, que es
   *  el que la fila sin plegar habría enseñado. */
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  /** Episodios vistos, o títulos añadidos. Siempre ≥ 1. */
  count: number;
  score?: number;
  /** Solo en series: el rango del día. En cine y juegos no hay rango que
   *  componer y construirlo para tirarlo deja el código afirmando lo que la
   *  vista niega. */
  from?: EpisodeRef;
  to?: EpisodeRef;
  list?: AddedList;
}

/** El día local de un instante, como 'YYYY-MM-DD'. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** La lista a la que fue a parar algo añadido. `owned` manda sobre el medio:
 *  un juego marcado "Lo tengo" no está en Pendientes — ese estado existe justo
 *  para sacarlo de ese cubo. */
const listOf = (e: AddedEvent): AddedList =>
  e.kind === "game" && e.owned ? "library" : addedList(e.kind);

/** Antes que este, en el orden del episodio. */
const before = (a: EpisodeRef, b: EpisodeRef) => a.season < b.season || (a.season === b.season && a.episode < b.episode);

interface Options {
  /** Cuántas filas devuelve como mucho. */
  limit?: number;
}

/** Las tres fuentes, plegadas y ordenadas de más reciente a más antigua. */
export function buildWall(
  events: {
    watched?: readonly WatchEvent[];
    rated?: readonly RatingEvent[];
    added?: readonly AddedEvent[];
  },
  { limit = 30 }: Options = {},
): WallItem[] {
  const items: WallItem[] = [];

  /* ── Lo visto: un grupo por título y día ────────────────────────────────── */
  const watched = new Map<string, WallItem>();
  for (const e of events.watched ?? []) {
    const day = localDay(e.at);
    const key = `w:${e.kind}:${e.tmdb_id}:${day}`;
    const ep = { season: e.season_number, episode: e.episode_number };
    const acc = watched.get(key);
    if (!acc) {
      watched.set(key, {
        key, verb: "watched", kind: e.kind, at: e.at,
        tmdb_id: e.tmdb_id, name: e.name, poster_path: e.poster_path,
        count: 1,
        // El rango solo en series, por lo que dice el comentario del tipo.
        ...(e.kind === "tv" ? { from: ep, to: ep } : {}),
      });
      continue;
    }
    acc.count += 1;
    // El instante del grupo es el del evento MÁS RECIENTE, que es por donde se
    // ordena el muro; las fuentes no prometen venir ordenadas.
    if (e.at > acc.at) {
      acc.at = e.at;
      acc.name = e.name;
      acc.poster_path = e.poster_path;
    }
    if (acc.from && acc.to) {
      if (before(ep, acc.from)) acc.from = ep;
      if (before(acc.to, ep)) acc.to = ep;
    }
  }
  items.push(...watched.values());

  /* ── Lo añadido: un grupo por medio, lista y día ─────────────────────────── */
  const added = new Map<string, WallItem>();
  for (const e of events.added ?? []) {
    const day = localDay(e.at);
    const list = listOf(e);
    const key = `a:${e.kind}:${list}:${day}`;
    const acc = added.get(key);
    if (!acc) {
      added.set(key, {
        key, verb: "added", kind: e.kind, at: e.at,
        tmdb_id: e.tmdb_id, name: e.name, poster_path: e.poster_path,
        count: 1, list,
      });
      continue;
    }
    acc.count += 1;
    if (e.at > acc.at) {
      acc.at = e.at;
      acc.tmdb_id = e.tmdb_id;
      acc.name = e.name;
      acc.poster_path = e.poster_path;
    }
  }
  items.push(...added.values());

  /* ── Lo puntuado: tal cual ───────────────────────────────────────────────── */
  for (const e of events.rated ?? []) {
    items.push({
      key: `r:${e.kind}:${e.tmdb_id}:${e.at}`, verb: "rated", kind: e.kind, at: e.at,
      tmdb_id: e.tmdb_id, name: e.name, poster_path: e.poster_path,
      count: 1, score: e.score,
    });
  }

  // Desempate por clave: dos hechos del mismo instante (una importación escribe
  // cientos con la misma marca de tiempo) tienen que salir siempre en el mismo
  // orden o el muro baila entre renders de los mismos datos.
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key)).slice(0, limit);
}
