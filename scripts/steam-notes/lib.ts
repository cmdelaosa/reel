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
  /* De qué fuente vino la nota que hay (0090): 'steam' o 'rawg'. Se mira antes
     de escribir un null encima — ver el `update` de index.ts. */
  metacritic_source: string | null;
  steam_reviews: unknown;
  steam_notes_refreshed_at: string | null;
}

export interface Wanted {
  id: string;
  name: string;
  appid: number;
  /* De dónde viene la nota que la fila ya tiene (0090). Viaja hasta aquí porque
     el `update` la mira antes de escribir un null encima: la de RAWG no se
     borra desde este cron. */
  source: string | null;
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
        source: g.metacritic_source,
        at: Number.isFinite(at) ? at : 0,
        nunca: !g.steam_notes_refreshed_at,
      };
    })
    .filter((x) => x.nunca || now - x.at > STALE_MS)
    .sort((a, b) => Number(b.nunca) - Number(a.nunca) || a.at - b.at)
    .map(({ id, name, appid, source }) => ({ id, name, appid, source }));
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

/* ── Cuando el appid no es el del juego ───────────────────────────────────
 *
 * El appid lo saca igdb-proxy de `external_games` de IGDB, que cuelga de una
 * misma ficha VARIAS apps de Steam: la del juego, la de su playtest, la de la
 * banda sonora y ediciones sueltas. `steamAppid()` se queda con la primera que
 * venga, y la primera no siempre es el juego. Medido en producción el
 * 21-sep-2026, sobre 297 juegos con appid:
 *
 *   Chants of Sennaar   1515190 → «Chants Of Sennaar Playtest», 0 reseñas
 *   Dead Cells          1087210 → redirige a 588650, 0 reseñas en la de entrada
 *   Borderlands 2        379880 → redirige a 49520,  0 reseñas
 *
 * Los tres se veían igual desde aquí: la tienda contesta bien y dice que no hay
 * reseñas, así que este cron guardaba `null` y la carátula se quedaba muda
 * mientras Steam tenía 183.000 reseñas de ese mismo juego.
 *
 * LO QUE LOS DISTINGUE de un juego recién salido —que SÍ tiene cero reseñas de
 * verdad— es que hay que preguntarle a la tienda una segunda cosa. Por eso la
 * reparación solo se intenta cuando las reseñas salen a cero: es el único caso
 * sospechoso, son cuatro juegos de trescientos, y así la pasada normal sigue
 * costando dos peticiones por juego.
 *
 * Las dos averías necesitan respuestas distintas, y de ahí las dos funciones:
 * la redirección la resuelve la propia tienda (`appdetails` devuelve el appid
 * canónico dentro de `data`), y el playtest no —es OTRO producto, con su propia
 * ficha— así que hay que buscar el juego por su nombre. */

/** El nombre reducido a lo que dos catálogos comparten.
 *
 *  ESPEJO de `nameKey` en app/src/domain/steamMatch.ts, no un import: aquello
 *  es del bundle del navegador y esto un guión de Node fuera de `app/`. Mismo
 *  trato que `reviewsOf` con normalize.ts. Si una cambia, la otra también. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Las palabras con las que Steam nombra lo que NO es el juego.
 *
 *  Se buscan al FINAL del nombre («Chants Of Sennaar Playtest», «… Demo», «…
 *  Soundtrack»), que es como la tienda las escribe, y buscarlas solo ahí es lo
 *  que deja en paz a los juegos que las llevan dentro: «Beta Squad», «The Test
 *  Drive», «Demolition Company». */
const SATELITES = [
  "playtest",
  "play test",
  "demo",
  "beta",
  "soundtrack",
  "original soundtrack",
  "ost",
  "artbook",
  "art book",
];

/** ¿La ficha que la tienda enseña con este appid es otra cosa que el juego?
 *
 *  Las dos condiciones, y las dos hacen falta:
 *    · el nombre de la app acaba en una de las palabras satélite, y
 *    · no es el nombre del juego — porque un juego puede LLAMARSE «Beta», y
 *      entonces esa palabra no lo convierte en el satélite de nadie. */
export function esSatelite(appName: string, gameName: string): boolean {
  const app = nameKey(appName);
  if (!app || app === nameKey(gameName)) return false;
  return SATELITES.some((s) => app === s || app.endsWith(` ${s}`));
}

/** La ficha que la tienda sirve para un appid: su nombre y su appid CANÓNICO.
 *
 *  `data.steam_appid` no siempre es el que se pidió: las entradas secundarias
 *  de un juego —ediciones, regiones, paquetes— responden con el appid del juego
 *  de verdad. Eso es la tienda corrigiéndonos, y es gratis creerle.
 *
 *  Null es «no ha contestado por este appid»: un `success: false` es un juego
 *  retirado o que no se sirve a esta región, y de ahí no se deduce nada. */
export function fichaDeTienda(
  payload: unknown,
  pedido: number,
): { appid: number; name: string } | null {
  const entry = (payload as Record<string, { success?: unknown; data?: unknown }> | null)
    ?.[String(pedido)];
  if (!entry || entry.success !== true) return null;
  const data = entry.data as { steam_appid?: unknown; name?: unknown } | null;
  const appid = typeof data?.steam_appid === "number" && data.steam_appid > 0
    ? data.steam_appid
    : pedido;
  return { appid, name: typeof data?.name === "string" ? data.name : "" };
}

/** El appid del juego en una respuesta de `storesearch`, o null.
 *
 *  SOLO acepta la igualdad exacta de nombres normalizados, y eso es lo que hace
 *  que esto pueda escribir en la base sin una persona delante: «Dead Cells»
 *  casa con «Dead Cells» y no con «Dead Cells: Return to Castlevania», que es
 *  el siguiente de los seis resultados que la tienda devuelve. Casar «por
 *  aproximación» es como acaba en una biblioteca el juego que no era — ver la
 *  cabecera de app/src/domain/steamMatch.ts, que cuenta esa noche.
 *
 *  Y DOS EXACTOS TAMPOCO VALEN. Hay juegos distintos que se llaman igual: el
 *  Prey de 2006 y el de 2017, con su ficha cada uno en la tienda. Quedarse con
 *  el primero sería elegir a cara o cruz, y lo que se elige aquí se escribe en
 *  la base marcado como «lo dice la tienda» — o sea que el appid equivocado se
 *  queda, y encima protegido de que IGDB lo corrija. Con más de uno: null, la
 *  fila se queda como está y la nota sigue sin salir, que es lo que ya pasaba. */
export function appidDeLaBusqueda(payload: unknown, gameName: string): number | null {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const quiero = nameKey(gameName);
  if (!quiero) return null;
  const exactos: number[] = [];
  for (const it of items) {
    const id = (it as { id?: unknown })?.id;
    const name = (it as { name?: unknown })?.name;
    if (typeof id !== "number" || id <= 0 || typeof name !== "string") continue;
    if (nameKey(name) === quiero && !exactos.includes(id)) exactos.push(id);
  }
  return exactos.length === 1 ? exactos[0] : null;
}
