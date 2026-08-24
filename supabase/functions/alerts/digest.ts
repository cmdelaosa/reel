/* El correo diario: asunto y cuerpo. Vive aquí y no en index.ts porque aquel
   sirve al importarse (Deno.serve en el módulo), así que nada suyo se puede
   importar desde una prueba — el mismo motivo por el que tmdb-proxy/rank.ts
   existe al lado de su index.

   Lo que se prueba aquí es la parte que se le manda a alguien por correo y no
   se puede retirar: que el asunto no llame episodios a las películas, que las
   dos listas salgan bajo su propio encabezado, y que un título con `<` no se
   convierta en etiqueta dentro de una bandeja de entrada. */

/** Lo que las dos fuentes de aviso tienen en común una vez normalizadas. */
export interface Alertable {
  user_id: string;
  episode_id: string;
  /** La tercera columna del sello (0071): 'episode' | 'theatrical' | 'digital'. */
  event: string;
  /** El tipo de notificación, que es también el de las preferencias. */
  type: "new_episode" | "movie_release";
  /** El título, que en el correo va destacado. */
  title: string;
  /** El resto de la línea: el episodio, o qué estreno es. */
  detail: string;
  payload: Record<string, unknown>;
}

const heading = (type: Alertable["type"]) =>
  type === "movie_release" ? "Releases from movies you follow:" : "New episodes from shows you follow:";

/* Un correo por persona y corrida, con lo suyo de los dos tipos bajo su propio
   encabezado. Dos correos el mismo día —uno de series y otro de cine— serían
   dos interrupciones por lo mismo: "esto que sigues ya está". */
const groupByType = (rows: Alertable[]) =>
  ([
    ["new_episode", rows.filter((r) => r.type === "new_episode")],
    ["movie_release", rows.filter((r) => r.type === "movie_release")],
  ] as [Alertable["type"], Alertable[]][]).filter(([, list]) => list.length > 0);

/* Los títulos vienen de TMDB y acaban dentro del HTML de un correo. Ninguno ha
   traído nunca un `<`, pero el día que uno lo haga no puede convertirse en
   etiqueta en la bandeja de nadie. La versión de texto plano no lo necesita. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function digestHtml(rows: Alertable[]): string {
  const blocks = groupByType(rows)
    .map(([type, list]) => {
      // El título en negrita y el detalle detrás, como iba antes de que hubiera
      // dos fuentes: quince líneas planas son bastante menos legibles.
      const items = list
        .map((r) => `<li><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.detail)}</li>`)
        .join("");
      return `<p>${heading(type)}</p><ul>${items}</ul>`;
    })
    .join("");
  return `${blocks}<p>— Reel</p>`;
}

export function digestText(rows: Alertable[]): string {
  const blocks = groupByType(rows)
    .map(([type, list]) => `${heading(type)}\n${list.map((r) => `• ${r.title} — ${r.detail}`).join("\n")}`)
    .join("\n\n");
  return `${blocks}\n\n— Reel`;
}

/** El asunto dice lo que hay dentro. Con los dos tipos mezclados no se puede
 *  nombrar ninguno sin mentir sobre el otro, así que ahí se generaliza. */
export function emailSubject(rows: Alertable[]): string {
  const movies = rows.filter((r) => r.type === "movie_release").length;
  const eps = rows.length - movies;
  if (movies === 0) return `${eps} new ${eps === 1 ? "episode" : "episodes"} from your shows`;
  if (eps === 0) return `${movies} ${movies === 1 ? "movie" : "movies"} you follow out today`;
  return `${rows.length} new things from your list`;
}
