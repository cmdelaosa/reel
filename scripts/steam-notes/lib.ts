/* Las decisiones del cron de notas de Steam, separadas de la red y de la base
   para que se puedan probar: a quién se le pregunta, en qué orden, y qué
   significa exactamente cada forma de respuesta de la tienda.

   Lo de leer las respuestas es un ESPEJO de supabase/functions/igdb-proxy/
   normalize.ts (`steamReviews`, `metacritic`), no un import: aquel es Deno con
   su propio tsconfig y este es un guión de Node fuera de `app/`. Mismo criterio
   que `priceCents` en steam-prices/lib.ts. Si una cambia, la otra también. */

/** Una fila de `titles` que puede tener notas de Steam. */
export interface Game {
  id: string;
  name: string | null;
  steam_appid: number;
  metacritic: number | null;
  steam_reviews: unknown;
  steam_notes_refreshed_at: string | null;
}

export interface Wanted {
  id: string;
  name: string;
  appid: number;
}

/** Cuándo una nota se considera rancia.
 *
 *  Siete días, y no veinte horas como los precios. Lo que estas dos columnas
 *  guardan casi no se mueve: un porcentaje de reseñas con cien mil votos no
 *  cambia de un día para otro, y la nota de Metacritic no cambia nunca después
 *  del lanzamiento. Refrescar a diario gastaría la paciencia de la tienda —que
 *  es el recurso escaso de todo esto— en volver a traer el mismo número.
 *
 *  El efecto que sí importa es el otro: con la ventana corta, la pasada diaria
 *  se la comen los juegos ya sabidos y el atasco de los que NUNCA han tenido
 *  nota tarda semanas en drenarse. Con siete días, el primer día se lleva lo que
 *  cabe de la cola de nuevos y los seis siguientes también. */
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** A qué juegos hay que preguntarles, y en qué orden.
 *
 *  El orden ES la política:
 *    0. lo que nunca se ha preguntado — el hueco que se ve en la ficha;
 *    1. lo preguntado hace más de una semana, de más viejo a más nuevo.
 *
 *  Y lo fresco NO ENTRA, igual que en los precios: metiendo los trescientos
 *  juegos en cada pasada, el tope por ejecución se lo comerían siempre los
 *  primeros por orden alfabético y los últimos no llegarían nunca. */
export function queueFor(games: Game[], now: number): Wanted[] {
  return games
    .filter((g) => Number.isInteger(g.steam_appid) && g.steam_appid > 0)
    .map((g) => {
      /* Una marca ilegible cuenta como el principio de los tiempos, no como
         NaN: comparar con NaN da siempre false, y esa fila se quedaría fuera de
         la cola para siempre sin que nada lo dijera. */
      const at = g.steam_notes_refreshed_at ? Date.parse(g.steam_notes_refreshed_at) : NaN;
      return {
        id: g.id,
        name: g.name ?? String(g.steam_appid),
        appid: g.steam_appid,
        at: Number.isFinite(at) ? at : 0,
        nunca: !g.steam_notes_refreshed_at,
      };
    })
    .filter((x) => x.nunca || now - x.at > STALE_MS)
    .sort((a, b) => Number(b.nunca) - Number(a.nunca) || a.at - b.at)
    .map(({ id, name, appid }) => ({ id, name, appid }));
}

/* ── Lo que la tienda contesta, y qué significa cada forma ─────────────────
 *
 * Las dos lecturas devuelven `{ touch }`, y ESA es la distinción que hace falta
 * en las dos columnas: `touch: false` es «no lo sabemos, deja lo que hubiera» y
 * `touch: true` con valor null es «lo hemos preguntado y no hay nota». Escribir
 * null en el primer caso cambia un dato bueno de ayer por ninguno, que es justo
 * el fallo que este cron viene a arreglar. */

export interface Read<T> {
  touch: boolean;
  value: T | null;
}

const NO: Read<never> = { touch: false, value: null };

/** El porcentaje de reseñas positivas y cuántas hay, de `appreviews`.
 *
 *  Se guarda el porcentaje CALCULADO, no el `review_score` de Steam (un 0-9
 *  propio suyo) ni su `review_score_desc`: el primero no significa nada fuera de
 *  la tienda y el segundo es texto de interfaz en el idioma que respondiera ese
 *  día. La etiqueta la pone el cliente, en el idioma de quien mira. */
export function reviewsOf(payload: unknown): Read<{ percent: number; count: number }> {
  const q = (payload as { query_summary?: Record<string, unknown> } | null)?.query_summary;
  // Sin `query_summary` no ha contestado a la pregunta, aunque el HTTP fuera 200.
  if (!q || typeof q !== "object") return NO;
  const pos = q.total_positive;
  const total = q.total_reviews;
  if (typeof pos !== "number" || typeof total !== "number") return NO;
  // Cero reseñas SÍ es una respuesta: un juego recién salido no tiene nota de
  // la gente, y eso se guarda como null para no volver a preguntarlo mañana.
  if (total <= 0) return { touch: true, value: null };
  return { touch: true, value: { percent: Math.round((pos / total) * 100), count: total } };
}

/** La nota de la crítica que Steam trae dentro de `appdetails`.
 *
 *  Se pide con `filters=metacritic`, que recorta la respuesta de veintidós kB a
 *  ciento treinta bytes. Formas medidas contra la tienda el 28-08-2026:
 *
 *    { "292030":  { success: true,  data: { metacritic: { score: 93, … } } } }
 *    { "774171":  { success: true,  data: [] } }        → no tiene nota
 *    { "9999…":   { success: false } }                  → retirado o no existe
 *
 *  El `success: false` NO se escribe: es lo que devuelve un juego que la tienda
 *  ha quitado o que no sirve a esta región, y guardar null ahí borraría una nota
 *  buena por un problema que no es del juego. Se deja como estaba y se vuelve a
 *  intentar dentro de una semana.
 *
 *  Y solo 0-100: un `score` fuera de ese rango es la tienda diciendo algo que no
 *  entendemos, y pintarlo sería peor que no pintarlo. */
export function metacriticOf(payload: unknown, appid: number): Read<number> {
  const entry = (payload as Record<string, { success?: unknown; data?: unknown }> | null)
    ?.[String(appid)];
  if (!entry || entry.success !== true) return NO;
  const score = (entry.data as { metacritic?: { score?: unknown } } | null)?.metacritic?.score;
  if (typeof score !== "number") return { touch: true, value: null };
  return score >= 0 && score <= 100 ? { touch: true, value: score } : { touch: true, value: null };
}
