/* Las decisiones del cron de Metascores de RAWG, separadas de la red y de la
   base para que se puedan probar. Aquí vive la parte que de verdad se puede
   equivocar: **decidir que dos fichas son el mismo juego**.

   RAWG no comparte identificador con IGDB, así que el puente es el nombre — y
   un nombre solo no basta. Medido contra su API el 28-08-2026 con juegos de
   esta biblioteca, buscando por nombre y quedándose con el primer resultado:

     · "Tetris" (1989, Game Boy)      → TETRIS de 2011, Metascore 65
     · "Mission: Impossible" (1998)   → Mission: Impossible (1990), 61
     · "Bomberman 64" (1997)          → un Bomberman de 2017

   Tres notas reales de tres juegos que no son el que se pidió. Una celda vacía
   se entiende; un 65 en el Tetris de Game Boy es una mentira con formato de
   dato, y no hay forma de que quien la lea la detecte. De ahí que emparejar sea
   lo que más código y más pruebas tiene de todo este guión. */

/** Una fila de `titles` candidata a llevar Metascore de RAWG. */
export interface Game {
  id: string;
  name: string;
  first_air_date: string | null;
  platforms: string[] | null;
  metacritic: number | null;
  metacritic_source: string | null;
  rawg_id: number | null;
  rawg_refreshed_at: string | null;
}

/** Un resultado de la búsqueda de RAWG, con lo que se mira de él. */
export interface Candidato {
  id: number;
  name: string;
  released: string | null;
  metacritic: number | null;
  platforms?: { platform: { name: string } }[] | null;
}

/** El nombre, reducido a lo que dos catálogos distintos escriben igual.
 *
 *  Mayúsculas ("GHOST TRICK" en RAWG), puntuación ("Mario Kart: Double Dash!!"
 *  contra "Mario Kart: Double Dash"), el ampersand y el año entre paréntesis que
 *  RAWG añade para desambiguar ("Donkey Kong (1994)"). Lo que queda son las
 *  palabras, que es lo único en lo que los dos coinciden de verdad. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** El nombre de plataforma, reducido a una clave que las dos listas comparten.
 *
 *  IGDB dice "Nintendo Switch" y RAWG "Nintendo Switch"; IGDB "Super Nintendo
 *  Entertainment System" y RAWG "SNES". Sin esta tabla la comparación de
 *  plataformas —que es el desempate bueno— fallaría justo en las consolas
 *  viejas, que son las que más ficha repetida tienen. */
const CONSOLAS: [RegExp, string][] = [
  [/^nintendo switch 2/, "switch2"],
  [/^nintendo switch/, "switch"],
  [/^wii u/, "wiiu"],
  [/^wii/, "wii"],
  [/^nintendo 64|^n64/, "n64"],
  [/^nintendo 3ds|^3ds/, "3ds"],
  [/^nintendo ds|^ds$/, "ds"],
  [/^nintendo gamecube|^gamecube/, "gamecube"],
  [/^game boy advance|^gba/, "gba"],
  [/^game boy color|^gbc/, "gbc"],
  [/^game boy/, "gameboy"],
  [/^super nintendo|^snes|^super famicom/, "snes"],
  [/^nintendo entertainment system|^nes$|^famicom/, "nes"],
  [/^playstation 5|^ps5/, "ps5"],
  [/^playstation 4|^ps4/, "ps4"],
  [/^playstation 3|^ps3/, "ps3"],
  [/^playstation 2|^ps2/, "ps2"],
  [/^playstation vita|^ps vita/, "vita"],
  [/^playstation portable|^psp/, "psp"],
  [/^playstation/, "ps1"],
  [/^xbox series/, "xboxseries"],
  [/^xbox one/, "xboxone"],
  [/^xbox 360/, "xbox360"],
  [/^xbox/, "xbox"],
  [/^pc|^windows|^macos|^mac|^linux/, "pc"],
];

export function platKey(name: string): string {
  const s = norm(name);
  for (const [re, key] of CONSOLAS) if (re.test(s)) return key;
  return s.replace(/ /g, "");
}

const anio = (fecha: string | null | undefined): number | null => {
  const y = Number(String(fecha ?? "").slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
};

/* ── Las ediciones ────────────────────────────────────────────────────────
 *
 * "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition" no
 * está en RAWG con ese nombre, y por nombre exacto no empareja con nada. Pero
 * el juego SÍ está, y su Metascore —96— es el del juego, no el del envoltorio.
 *
 * Así que cuando la búsqueda por el nombre entero no da nada, se vuelve a
 * buscar por el nombre a secas. Y solo con estas etiquetas, que significan "el
 * mismo juego, otra vez a la venta":
 *
 *   · edition (Complete, Deluxe, Classic, Nintendo Switch 2…) / goty
 *
 * La lista es corta A PROPÓSITO. La primera versión aceptaba también `complete`,
 * `deluxe`, `anniversary`, `bundle` y `classic` sueltos, y eso convierte
 * cualquier subtítulo que lleve esa palabra en un corte: "Dragon Quest: The
 * Complete Journey" se quedaría en "Dragon Quest" y heredaría la nota de un
 * juego que no es. Con `edition` delante —que es como se escriben de verdad
 * estas coletillas— el corte solo ocurre donde significa lo que creemos.
 *
 * NO entran `remastered`, `remake` ni `HD`, y no es un olvido: la crítica los
 * puntúa por separado —Valkyria Chronicles tiene un 86 y su remasterización un
 * 80— así que enseñar el número del original ahí sería enseñar la nota de otra
 * cosa. Esos se quedan sin nota, que es lo honesto. */
const EDICIONES = /\b(edition|goty|game of the year)\b/;

/** El nombre sin la coletilla de edición, o null si no la lleva.
 *
 *  Se corta por el último guion o dos puntos, y solo si lo que va detrás es una
 *  de las etiquetas de arriba: "Tears of the Kingdom - Nintendo Switch 2
 *  Edition" pierde la cola, y "Zelda II: The Adventure of Link" no la pierde,
 *  porque su subtítulo no es una edición sino el título. */
export function sinEdicion(nombre: string): string | null {
  const corte = Math.max(nombre.lastIndexOf(" - "), nombre.lastIndexOf(" – "), nombre.lastIndexOf(": "));
  if (corte <= 0) return null;
  const cola = nombre.slice(corte);
  if (!EDICIONES.test(cola.toLowerCase())) return null;
  const base = nombre.slice(0, corte).trim();
  return base.length >= 3 ? base : null;
}

/** El candidato que es el mismo juego, o null.
 *
 *  Tres reglas, en este orden:
 *
 *  1. **El nombre tiene que coincidir exacto** una vez normalizado. Nada de
 *     parecidos: "Zelda" contra "Zelda II" es un nombre parecido y otro juego.
 *  2. De los que coinciden, vale el que **comparte plataforma** o el que sale
 *     el mismo año (±1). Ese "o" es deliberado y cada mitad salva un caso real:
 *     Breath of the Wild está en esta base con fecha de 2025 —la edición de
 *     Switch 2— y en RAWG con la de 2017, así que por año se descartaría el
 *     97 que buscábamos; y "Mission: Impossible" de 1998 solo se distingue del
 *     de 1990 por la consola.
 *  3. Si quedan varios, gana el que comparte plataforma, y entre esos el más
 *     cercano en el tiempo.
 *
 *  Sin ninguna de las dos señales no se empareja. Preferir "casi seguro" a
 *  "nada" es exactamente cómo entra el 65 del Tetris equivocado. */
export function emparejar(
  juego: Pick<Game, "name" | "first_air_date" | "platforms">,
  candidatos: readonly Candidato[],
): Candidato | null {
  const puntuados = mismoNombre(juego, juego.name, candidatos)
    .filter((x) => x.solapa || x.dy <= 1);
  return puntuados[0]?.c ?? null;
}

/** Lo mismo, pero para la EDICIÓN de un juego, buscando por su nombre a secas.
 *
 *  Aquí no se exige ni consola ni año, y tiene que ser así: la edición de
 *  Switch 2 de Tears of the Kingdom sale en 2025 y solo para Switch 2, y el
 *  juego que RAWG tiene es de 2023 y de Switch. Las dos señales que en el caso
 *  general separan un juego de otro son justo las que aquí cambian, porque un
 *  reenvasado es eso: el mismo juego, otro año y otra consola.
 *
 *  Lo que sostiene el emparejamiento es el nombre completo del juego base, que
 *  ya es específico —quien busque "Tears of the Kingdom" no va a chocar con
 *  otro juego llamado igual—, y que la coletilla que se ha quitado sea una de
 *  las de `sinEdicion`. Entre varios candidatos sigue ganando el que comparte
 *  consola, y luego el más cercano en el tiempo. */
export function emparejarEdicion(
  juego: Pick<Game, "name" | "first_air_date" | "platforms">,
  base: string,
  candidatos: readonly Candidato[],
): Candidato | null {
  return mismoNombre(juego, base, candidatos)[0]?.c ?? null;
}

/** Los candidatos que se llaman igual que `nombre`, ordenados por lo cerca que
 *  están del juego: primero los que comparten consola, después por año. */
function mismoNombre(
  juego: Pick<Game, "first_air_date" | "platforms">,
  nombre: string,
  candidatos: readonly Candidato[],
): { c: Candidato; solapa: boolean; dy: number }[] {
  const nuestro = norm(nombre);
  const nuestroAnio = anio(juego.first_air_date);
  const nuestras = new Set((juego.platforms ?? []).map(platKey));

  return candidatos
    .filter((c) => norm(c.name ?? "") === nuestro)
    .map((c) => {
      const suyas = new Set((c.platforms ?? []).map((p) => platKey(p?.platform?.name ?? "")));
      const solapa = [...nuestras].some((p) => suyas.has(p));
      const suAnio = anio(c.released);
      /* Sin fecha en cualquiera de los dos lados la distancia es "infinita", no
         cero: un candidato sin año no puede aprobar por año, solo por consola. */
      const dy = nuestroAnio && suAnio ? Math.abs(suAnio - nuestroAnio) : Number.POSITIVE_INFINITY;
      return { c, solapa, dy };
    })
    .sort((a, b) => Number(b.solapa) - Number(a.solapa) || a.dy - b.dy);
}

/** El Metascore de un candidato, si lo tiene y es creíble.
 *
 *  RAWG deja `metacritic` a null en todo lo anterior a 2001 —Metacritic no
 *  existía— y en buena parte del catálogo pequeño. Eso NO es un fallo: es que no
 *  hay nota, y se guarda como tal para no volver a preguntarlo cada semana. */
export function scoreOf(c: Candidato | null): number | null {
  const n = c?.metacritic;
  return typeof n === "number" && n >= 0 && n <= 100 ? n : null;
}

/** Cuándo se vuelve a mirar un juego YA EMPAREJADO.
 *
 *  Treinta días. Un Metascore se congela a las pocas semanas del lanzamiento y
 *  no se mueve nunca más, así que lo único que este refresco persigue es el
 *  juego que salió ayer y todavía no tenía crítica. Preguntar más a menudo sería
 *  gastar la cuota mensual en volver a traer el mismo número. */
export const STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** Cuándo se vuelve a intentar uno que NO se pudo emparejar.
 *
 *  Siete días, y esta es la diferencia que importa: las dos filas se parecen
 *  —las dos tienen la marca puesta— pero dicen cosas distintas. Una emparejada
 *  es trabajo terminado; una sin emparejar es trabajo PENDIENTE, y lo que
 *  cambia no es el dato de RAWG sino nuestro código para encontrarlo.
 *
 *  Medido el 28-08-2026: la regla de las ediciones se escribió con 24 juegos
 *  sin emparejar, y al desplegarla no alcanzó a ninguno — todos llevaban la
 *  marca de esa misma mañana y no volvían a la cola hasta un mes después. Hubo
 *  que borrarla a mano con un `update` contra producción para que la mejora
 *  sirviera de algo. Con siete días, la siguiente entra sola. */
export const REINTENTO_MS = 7 * 24 * 60 * 60 * 1000;

export interface Wanted {
  id: string;
  name: string;
  first_air_date: string | null;
  platforms: string[] | null;
  rawg_id: number | null;
}

/** A qué juegos hay que preguntarles, y en qué orden.
 *
 *  Quién ENTRA: solo lo que no tiene nota de Steam. Steam manda donde llega
 *  —es la misma nota y ya está traída—, así que esto rellena los huecos: la
 *  consola, y el juego de Steam al que la tienda no le pone Metascore.
 *
 *  El orden:
 *    0. lo que nunca se ha buscado — el hueco que se ve en la ficha;
 *    1. lo rancio, de más viejo a más nuevo.
 *
 *  Y "rancio" no significa lo mismo en los dos casos: un juego emparejado
 *  espera un mes (`STALE_MS`) y uno que no se pudo emparejar, una semana
 *  (`REINTENTO_MS`). Lo primero es esperar a que la crítica se mueva; lo
 *  segundo, a que nos movamos nosotros.
 *
 *  Lo fresco no entra, por lo mismo que en los otros dos crones: si entrara,
 *  el tope por pasada se lo comerían siempre los mismos y la cola no bajaría. */
export function queueFor(juegos: Game[], now: number): Wanted[] {
  return juegos
    .filter((g) => g.metacritic == null || g.metacritic_source === "rawg")
    .map((g) => {
      const at = g.rawg_refreshed_at ? Date.parse(g.rawg_refreshed_at) : NaN;
      return {
        id: g.id,
        name: g.name,
        first_air_date: g.first_air_date,
        platforms: g.platforms,
        rawg_id: g.rawg_id,
        /* Una marca ilegible cuenta como el principio de los tiempos, no como
           NaN: comparar con NaN da siempre false y esa fila se quedaría fuera
           de la cola para siempre sin que nada lo dijera. */
        at: Number.isFinite(at) ? at : 0,
        nunca: !g.rawg_refreshed_at,
      };
    })
    .filter((x) => x.nunca || now - x.at > (x.rawg_id == null ? REINTENTO_MS : STALE_MS))
    .sort((a, b) => Number(b.nunca) - Number(a.nunca) || a.at - b.at)
    .map(({ id, name, first_air_date, platforms, rawg_id }) => ({
      id,
      name,
      first_air_date,
      platforms,
      rawg_id,
    }));
}
