/**
 * FilmAffinity → Reel: el núcleo que decide QUÉ se importa y CON QUÉ película de
 * TMDB se corresponde. Todo lo que hay aquí es puro o una consulta de lectura a
 * TMDB, para que `lib.test.ts` pueda juzgarlo sin base de datos y sin red.
 *
 * El scraping vive fuera (se hace desde el navegador con la sesión de FA, ver
 * README) y entra por un JSON. Aquí empieza el trabajo de verdad, que es el
 * emparejamiento: FA da un título EN ESPAÑOL, un año y un director, y hay que
 * dar con la película de TMDB sin colar una equivocada. Una nota escrita sobre
 * el título ajeno no se ve —queda una peli que no viste con una nota que no
 * pusiste— así que el criterio es duro a propósito: o el título normalizado
 * coincide exactamente, o el director tiene que confirmarlo.
 */

// Relativo, con extensión y sin dependencias: la misma forma de import que usa
// scripts/tvtime-import/lib.ts para compartir código con las edge functions.
import { tmdbFetch } from "../../supabase/functions/_shared/tmdb.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Json = Record<string, unknown>;

/** Alias a mano: id de FilmAffinity → id de película de TMDB.
 *
 *  Aquí acaban las que ninguna regla puede emparejar, porque el título español
 *  de FA y el de TMDB no comparten NADA: "Operación Monumento" contra
 *  "Monuments Men", "El juego de Kobe" contra "Kobe Doin' Work". El parecido no
 *  es bajo, es cero — no hay umbral que las salve sin colar basura por el mismo
 *  hueco, así que se fijan una a una y comprobadas por director y año.
 *
 *  El precedente es TVDB_ALIASES en scripts/tvtime-import/lib.ts, y la regla es
 *  la misma: la lista crece cuando el informe enseña una, nunca por adelantado. */
export const FA_ALIASES: Record<string, number> = {
  "924781": 848187,  // Juego de roles → Role Play (Thomas Vincent, 2023)
  "845553": 4552,    // 2 hermanas → Dos hermanas / 장화, 홍련 (Kim Jee-woon, 2003)
  "313049": 486947,  // The Guilty → El culpable / Den skyldige (Gustav Möller, 2018)
  "322601": 641483,  // Qué pasa cuando eres adulto → Entre amigos / Holly Slept Over (Joshua Friedlander, 2020)
  "295663": 152760,  // Operación Monumento → Monuments Men (George Clooney, 2014)
  "795100": 4787,    // El sueño de Casandra → El sueño de Cassandra (Woody Allen, 2007)
  "966387": 30599,   // El juego de Kobe → Kobe Doin' Work (Spike Lee, 2009)
};

/** Una fila del scrape de FilmAffinity, tal cual sale del navegador. */
export interface FaItem {
  id: string;              // id de FilmAffinity (film<id>.html)
  title: string;           // título en español, tal como lo muestra FA
  year: string;            // "2017"
  types: string[];         // ["Serie"], ["Cortometraje","Animación"], [] = película
  director: string;        // "Denis Villeneuve" o "Bill Lawrence (Creador), …"
  url: string;
  rating?: number | null;  // 1..10 en los votos; ausente en las listas
  date?: string | null;    // "8/07/2026" (D/M/AAAA) en los votos
}

/** Los tipos de FA que NO son cine: lo que se ve por temporadas o por episodios.
 *  Todo lo demás —película, documental, telefilm, corto, mediometraje— tiene en
 *  TMDB una ficha de `movie`, que es la que este importador sabe escribir. */
const NOT_FILM = new Set(["Serie", "Miniserie", "Show", "Episodio"]);

/** ¿Esta fila de FA es una película (en el sentido de `titles.kind = 'movie'`)? */
export const isFilm = (types: string[]): boolean => !types.some((t) => NOT_FILM.has(t));

/** Los tipos que el usuario puede dejar fuera aunque sean cine. Se pasan por
 *  bandera para que la decisión quede escrita en la llamada y no aquí. */
export const OPTIONAL_TYPES = ["Cortometraje", "Mediometraje", "TV"] as const;
export type OptionalType = (typeof OPTIONAL_TYPES)[number];

export function keepItem(types: string[], exclude: readonly OptionalType[]): boolean {
  if (!isFilm(types)) return false;
  return !types.some((t) => (exclude as readonly string[]).includes(t));
}

/** Minúsculas, sin acentos y sin puntuación: la forma en la que dos títulos que
 *  son el mismo se pueden comparar con `===`. */
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Los títulos que una fila de FA puede estar nombrando.
 *
 *  FA escribe a menudo el título doble: "Las vidas de Grace (Short Term 12)" es
 *  el español y el original, y "Boyhood (Momentos de una vida)" es al revés.
 *  Cuál es cuál no se sabe desde fuera, así que salen los dos como candidatos
 *  —más la cadena entera, por si el paréntesis era parte del título de verdad
 *  ("Alien (El octavo pasajero)" no, pero "Léon (The Professional)" tampoco es
 *  raro que lo sea en TMDB). */
export function titleVariants(faTitle: string): string[] {
  const out = [faTitle.trim()];
  const m = faTitle.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (m) {
    out.push(m[1].trim());
    out.push(m[2].trim());
  }
  return [...new Set(out.map((t) => t.trim()).filter(Boolean))];
}

/** Lo que se le PREGUNTA a TMDB, que no es lo mismo que lo que luego se compara.
 *
 *  El buscador de TMDB no tolera un título largo entero: "El Hobbit: La batalla
 *  de los cinco ejércitos" devuelve CERO resultados, y cualquiera de sus dos
 *  mitades devuelve la película a la primera. Así que se pregunta por partes —y
 *  se juzga después con el título completo, que es donde no se afloja nada. */
export function queryVariants(faTitle: string): string[] {
  const out: string[] = [];
  for (const v of titleVariants(faTitle)) {
    out.push(v);
    // "Saga. Episodio I: Subtítulo" parte por los dos sitios: unas veces el que
    // reconoce TMDB es el nombre de la saga y otras el del episodio.
    for (const part of v.split(/\s*[:.]\s+/)) {
      const p = part.trim();
      if (p.length >= 4) out.push(p);
    }
  }
  return [...new Set(out)].slice(0, 5);
}

/** El primer director de FA, sin el "(Creador)" ni los coautores. */
export function firstDirector(faDirector: string): string {
  const first = faDirector.split(",")[0] ?? "";
  return first.replace(/\([^)]*\)/g, "").replace(/\.\.\.$/, "").trim();
}

/** "8/07/2026" → "2026-07-08T12:00:00Z".
 *
 *  Mediodía UTC y no medianoche: `watched_at` se pinta en hora local (Madrid,
 *  UTC+1/+2) y una marca a las 00:00Z se vería el día anterior en el historial y
 *  en el mapa de calor. A las 12:00Z el día es el mismo en todo el huso. */
export function faDateToIso(d: string): string | null {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, day, month, year] = m;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(iso))) return null;
  return `${iso}T12:00:00Z`;
}

/** Un resultado de /search/movie, con lo poco que hace falta para juzgarlo. */
export interface Candidate {
  id: number;
  title: string;
  original_title: string;
  release_date?: string | null;
  popularity?: number | null;
}

export type Confidence = "exact" | "needs-director";

export interface Match {
  candidate: Candidate;
  confidence: Confidence;
  /** Por qué gana este y no otro — va al informe, que es lo que se revisa. */
  why: string;
}

const yearOf = (c: Candidate): number | null => {
  const y = Number((c.release_date ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
};

/** Números romanos a arábigos, y las abreviaturas que FA y TMDB escriben cada
 *  una a su manera. Sin esto "Misión imposible 2" y "Misión imposible II" son
 *  títulos distintos, y lo son en TREINTA de las mil películas de una cuenta
 *  normal: las sagas son justo lo que se numera. */
const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7",
  viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13",
};
const ABBREV: Record<string, string> = {
  dr: "doctor", vol: "volumen", pt: "parte", part: "parte", mr: "mister", st: "saint",
};

/** El título partido en piezas comparables. `norm` ya quitó acentos y
 *  puntuación; aquí se unifica lo que sigue escribiéndose de dos formas. */
export function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .map((t) => ROMAN[t] ?? ABBREV[t] ?? t);
}

/** Dice sobre conjuntos de palabras: 1 si son las mismas, 0 si no comparten
 *  ninguna. Es la medida que dice que "El padrino. Parte II" (FA) y "El padrino
 *  II" (TMDB) son la misma película sin decir lo mismo de "El padrino III". */
export function dice(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** El umbral de parecido a partir del cual un título merece que se le pregunte
 *  al director. Por debajo no se pregunta siquiera: dos películas de la misma
 *  saga comparten media docena de palabras, y el director TAMBIÉN suele ser el
 *  mismo, así que un umbral flojo convierte la confirmación en un sello. */
const DICE_MIN = 0.6;

/** Cuánto se parecen el título de FA y el de un candidato: 2 el mismo título,
 *  1 lo bastante parecido como para que decida el director, 0 nada.
 *  Se prueban las dos formas del candidato —el título traducido y el original—
 *  contra todas las variantes de FA. */
export function titleScore(faTitle: string, c: Candidate): number {
  const wants = titleVariants(faTitle).filter(Boolean);
  const has = [c.title, c.original_title].filter(Boolean);
  let best = 0;
  for (const w of wants) {
    for (const h of has) {
      const nw = tokens(w).join(" ");
      const nh = tokens(h).join(" ");
      if (!nw || !nh) continue;
      if (nw === nh) return 2;
      if (nw.length >= 6 && nh.length >= 6 && (nw.includes(nh) || nh.includes(nw))) best = Math.max(best, 1);
      if (dice(w, h) >= DICE_MIN) best = Math.max(best, 1);
    }
  }
  return best;
}

/** Elige la película de TMDB que corresponde a una fila de FA, o ninguna.
 *
 *  Las reglas, en orden y sin excepciones:
 *   · el año tiene que caer a ±1 del de FA (TMDB fecha por estreno mundial y FA
 *     por año de producción; un año de diferencia es corriente, dos ya no);
 *   · título idéntico normalizado → vale por sí solo;
 *   · título que solo se contiene → hace falta que el director confirme, y eso
 *     lo resuelve `confirmDirector` con una llamada más;
 *   · nada de lo anterior → sin match, y a la lista de repaso.
 *
 *  Entre varios que cumplen, gana el de título más parecido; a igualdad, el año
 *  más cercano; a igualdad, el más popular (que es como TMDB desempata las
 *  reposiciones y los remakes homónimos). */
export function pickMatch(fa: FaItem, candidates: Candidate[]): Match | null {
  const faYear = Number(fa.year);
  const scored = candidates
    .map((c) => {
      const ts = titleScore(fa.title, c);
      const y = yearOf(c);
      const dy = Number.isFinite(faYear) && y !== null ? Math.abs(y - faYear) : null;
      return { c, ts, dy };
    })
    .filter((s) => s.ts > 0 && s.dy !== null && s.dy <= 1);

  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.ts - a.ts ||
      (a.dy as number) - (b.dy as number) ||
      (b.c.popularity ?? 0) - (a.c.popularity ?? 0),
  );

  const top = scored[0];
  return {
    candidate: top.c,
    confidence: top.ts === 2 ? "exact" : "needs-director",
    why: `título ${top.ts === 2 ? "idéntico" : "parcial"}, año ±${top.dy}`,
  };
}

// ── TMDB (lectura) ──────────────────────────────────────────────────────────

const toCandidate = (r: Json): Candidate => ({
  id: r.id as number,
  title: (r.title as string) ?? "",
  original_title: (r.original_title as string) ?? "",
  release_date: (r.release_date as string) ?? null,
  popularity: (r.popularity as number) ?? null,
});

/** Los candidatos de TMDB para una fila de FA.
 *
 *  Dos búsquedas y no una: con `year` TMDB filtra de verdad —y una peli fechada
 *  un año antes en TMDB desaparece—, así que la que lleva año sirve para acertar
 *  y la que no lo lleva para no perder nada. Se pide en español porque el
 *  título de FA lo está; `original_title` viene igual en las dos. */
export async function searchMovies(key: string, fa: FaItem): Promise<Candidate[]> {
  const seen = new Map<number, Candidate>();
  // Parar en cuanto haya un candidato con el título idéntico y el año a ±1: ya
  // no hay nada mejor que encontrar, y cada consulta de más son mil peticiones
  // en una cuenta de mil películas.
  const yaEsta = () => {
    const faYear = Number(fa.year);
    for (const c of seen.values()) {
      if (titleScore(fa.title, c) !== 2) continue;
      const y = Number((c.release_date ?? "").slice(0, 4));
      if (Number.isFinite(faYear) && Number.isFinite(y) && Math.abs(y - faYear) <= 1) return true;
    }
    return false;
  };

  for (const q of queryVariants(fa.title)) {
    const enc = encodeURIComponent(q);
    const paths = [
      `/search/movie?query=${enc}&include_adult=false&language=es-ES&year=${encodeURIComponent(fa.year)}`,
      `/search/movie?query=${enc}&include_adult=false&language=es-ES`,
    ];
    for (const p of paths) {
      const data = (await tmdbFetch(key, p).then((r: Any) => r.json())) as Json;
      for (const r of ((data.results as Json[]) ?? []).slice(0, 12)) {
        const c = toCandidate(r);
        if (!seen.has(c.id)) seen.set(c.id, c);
      }
      if (yaEsta()) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/** ¿Dirige esta película el director que dice FA? Se compara por apellido
 *  normalizado: FA escribe "Denis Villeneuve" y TMDB también, pero los nombres
 *  con partícula, los dos apellidos españoles y las transliteraciones asiáticas
 *  divergen lo justo para que la igualdad estricta descarte matches buenos. */
export async function confirmDirector(key: string, tmdbId: number, faDirector: string): Promise<boolean> {
  const want = norm(firstDirector(faDirector));
  if (!want) return false;
  const data = (await tmdbFetch(key, `/movie/${tmdbId}/credits`).then((r: Any) => r.json())) as Json;
  const directors = ((data.crew as Json[]) ?? [])
    .filter((c) => c.job === "Director")
    .map((c) => norm((c.name as string) ?? ""));
  const wantTokens = want.split(" ").filter((t) => t.length >= 3);
  return directors.some((d) => {
    if (d === want) return true;
    const tokens = d.split(" ").filter((t) => t.length >= 3);
    return wantTokens.some((t) => tokens.includes(t));
  });
}
