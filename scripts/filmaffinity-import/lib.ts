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

/** Cuánto se parecen el título de FA y el de un candidato: 2 exacto, 1 uno
 *  contiene al otro (con cuerpo suficiente para que no sea casualidad), 0 nada.
 *  Se prueban las dos formas del candidato —el título traducido y el original—
 *  contra todas las variantes de FA. */
export function titleScore(faTitle: string, c: Candidate): number {
  const wants = titleVariants(faTitle).map(norm).filter(Boolean);
  const has = [c.title, c.original_title].map(norm).filter(Boolean);
  let best = 0;
  for (const w of wants) {
    for (const h of has) {
      if (w === h) return 2;
      if (w.length >= 6 && h.length >= 6 && (w.includes(h) || h.includes(w))) best = Math.max(best, 1);
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
  const queries = titleVariants(fa.title);
  const seen = new Map<number, Candidate>();
  for (const q of queries) {
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
      // Con un puñado de candidatos ya hay de sobra para decidir; la segunda
      // búsqueda solo se paga cuando la primera se queda corta.
      if (seen.size >= 8) break;
    }
    if (seen.size >= 8) break;
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
