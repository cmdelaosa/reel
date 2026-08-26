/* Qué forma tiene una fila según el medio de lo que describe. Puro, con tests
   al lado (mediumCopy.test.ts).

   Existe por una razón concreta: cada película y cada juego arrastran un
   episodio sintético S1E1 (migraciones 0067 y 0071) que está ahí para que
   "vista" / "terminado" tengan dónde escribirse, y que NO debe leerse nunca. El
   muro de amigos y el historial reciben ese episodio como cualquier otro, y la
   única cosa que impide que vuelvan a imprimir "S1 · E1" sobre una película o
   sobre un videojuego es esta decisión — así que vive fuera de los componentes,
   donde se puede probar, en vez de repartida en ternarios que nadie compara
   entre sí.

   Todas las funciones de aquí preguntan `kind === "tv"` en positivo, nunca
   `!== "movie"`. Es la misma regla que 0071 usa en SQL y por el mismo motivo:
   con el filtro positivo, el medio que llegue el año que viene hereda el
   comportamiento prudente sin que nadie se acuerde de esta línea. */

/* Declarado aquí y no importado de lib/medium, que tiene el mismo tipo: este
   módulo es puro y sus tests corren sin tocar el DOM, mientras que lib/medium
   escribe `data-medium` en <html> al importarse. Es la misma separación que ya
   hay entre domain/gameStatus (declara PlayState) y lib/igdb (lo importa). */
export type Medium = "tv" | "movie" | "game";

/** Cómo se llama el medio de una fila, para las listas que lo dicen con
 *  palabras además de con el glifo. Devuelve la CLAVE del diccionario, no el
 *  texto: traducir es de la capa que pinta, y así esto sigue siendo puro.
 *
 *  Vive aquí y no repetido en cada componente porque ya se pinta en dos sitios
 *  —el glifo del muro y la píldora del historial— y son los mismos tres
 *  nombres. */
export const mediumLabel = (kind: Medium): string =>
  kind === "movie" ? "Movie" : kind === "game" ? "Game" : "TV series";

/** Cómo se cuenta un "hecho" en el muro. */
export type WatchedPhrase =
  /** "vio S1 · E3 de Severance" — una serie se ve por partes. */
  | "with-episodes"
  /** "vio Dune: Part Two" — una película se ve entera y de una vez. */
  | "whole-title"
  /** "terminó Silksong" — un juego no se ve: se termina. El evento por debajo
   *  es el MISMO watch_event que en cine (0073 lo dice: "me salieron los
   *  créditos"), pero llamarlo "vio" sería la etiqueta prestada que 0071 se
   *  negó a publicar. */
  | "whole-title-finished";

export const watchedPhrase = (kind: Medium): WatchedPhrase =>
  kind === "tv" ? "with-episodes" : kind === "game" ? "whole-title-finished" : "whole-title";

/** Cómo se llama la lista a la que se añade algo, que no es la misma en los tres
 *  medios: series y cine tienen "watchlist" y los juegos, "pendientes" — que es
 *  el nombre del cubo que ya existe en la biblioteca (Backlog). Decirle
 *  watchlist a una lista de juegos es decir "ver" de algo que se juega.
 *
 *  Y desde 0077 hay una TERCERA, que no la decide el medio sino la fila: un
 *  juego marcado "Lo tengo" (`library_entries.owned`, 0076) no está en
 *  Pendientes — ese estado existe justo para sacarlo de ese cubo—, así que de
 *  él se dice que fue a su BIBLIOTECA. Es lo que pasa con todo lo que entra
 *  por la importación de Steam. */
export type AddedList = "watchlist" | "backlog" | "library";

/** Lo que se puede saber mirando SOLO el medio. Se queda porque es el respaldo
 *  de `addedListOf`: un cliente nuevo contra un servidor viejo no recibe la
 *  lista y esto es lo que había. */
export const addedList = (kind: Medium): AddedList =>
  kind === "game" ? "backlog" : "watchlist";

/** La lista de una fila del muro.
 *
 *  Manda lo que diga el servidor, y no es pereza: quien sabe si la fila estaba
 *  marcada como "Lo tengo" es la consulta que la leyó, y recalcularlo aquí
 *  significaría mandar `owned` en cada fila del muro para volver a aplicar la
 *  misma regla — dos copias de una decisión que un día dirán cosas distintas.
 *  El respaldo es para el hueco entre desplegar el frontend y aplicar la
 *  migración, en el que la columna no llega. */
export const addedListOf = (kind: Medium, fromServer?: string | null): AddedList =>
  fromServer === "watchlist" || fromServer === "backlog" || fromServer === "library"
    ? fromServer
    : addedList(kind);

/** El nombre del medio EN PLURAL, que es como se encabeza una sección ("Cine",
 *  "Juegos") frente al singular de `mediumLabel`, que es como se etiqueta una
 *  fila ("Película"). Las dos formas existen porque el perfil usa las dos a la
 *  vez: el glifo de una fila y el título del bloque que la contiene.
 *
 *  Claves del diccionario, como todo lo de aquí — y las mismas que ya usa la
 *  barra de navegación, así que el bloque de cine del perfil y la pestaña Cine
 *  dicen exactamente la misma palabra. */
const PLURAL: Record<Medium, string> = { tv: "Shows", movie: "Movies", game: "Games" };

export const mediumPlural = (kind: Medium): string => PLURAL[kind];

/** Cómo se cuenta lo VISTO de un medio, para el desglose del día en la rejilla
 *  de actividad: "3 episodios · 1 película · 2 juegos terminados".
 *
 *  Otra vez claves y no texto, y otra vez TRES frases y no una con el nombre
 *  del medio interpolado: en español el género arrastra, y de un juego no se
 *  dice que se vio sino que se terminó — la misma distinción que `watchedPhrase`
 *  hace en el muro, aquí en forma de recuento.
 *
 *  Lleva `{n}` y no el número dentro: la traducción decide dónde va. */
export const watchedCountKey = (kind: Medium, n: number): string =>
  kind === "tv"
    ? (n === 1 ? "heat: {n} episode" : "heat: {n} episodes")
    : kind === "game"
    ? (n === 1 ? "heat: {n} game finished" : "heat: {n} games finished")
    : (n === 1 ? "heat: {n} movie" : "heat: {n} movies");

/** Si la fila puede decir "· N episodios" bajo el texto. Ni una película ni un
 *  juego tienen varios episodios que agrupar, así que el recuento nunca es suyo
 *  por mucho que el burst del RPC devuelva uno. */
export const showsEpisodeCount = (kind: Medium, count: number): boolean =>
  kind === "tv" && count > 1;

/** Qué va en las dos líneas de una fila del historial.
 *
 *  En una serie, el episodio manda: "S02 · E07" y debajo su título. En una
 *  película o en un juego el episodio no existe de cara a nadie, así que manda
 *  el título, y debajo el estudio — nunca el nombre del episodio sintético, que
 *  es una copia del título y repetirlo dos renglones seguidos no dice nada.
 *
 *  El "estudio" es la columna `network`, que cada medio llena con lo suyo: la
 *  cadena en series, la productora en cine y el desarrollador en juegos
 *  (igdb-proxy/normalize.ts, `studio`). */
export interface HistoryLines {
  /** La línea grande. */
  headline: "episode-number" | "title";
  /** La línea pequeña de debajo. */
  caption: "episode-name" | "studio";
}

export const historyLines = (kind: Medium): HistoryLines =>
  kind === "tv"
    ? { headline: "episode-number", caption: "episode-name" }
    : { headline: "title", caption: "studio" };

/** Cómo se llama el cajón de lo oculto en Explorar, en singular y en plural.
 *
 *  Otra vez una clave por medio y no el nombre interpolado: en español el
 *  género arrastra ("ocultas" / "ocultos"), y además lo que se oculta se dice
 *  con la palabra del medio — "series ocultas" sobre una rejilla de juegos era
 *  la etiqueta prestada de siempre.
 *
 *  Tabla y no ternarios encadenados, que es la forma que tiene aquí la regla de
 *  arriba: al medio que llegue el año que viene no le vale heredar en silencio
 *  las palabras de las series, y con un `Record<Medium, …>` no compila hasta
 *  que alguien escriba las suyas. */
const HIDDEN: Record<Medium, { one: string; many: string }> = {
  tv: { one: "hidden show", many: "hidden shows" },
  movie: { one: "hidden movie", many: "hidden movies" },
  game: { one: "hidden game", many: "hidden games" },
};

export const hiddenLabel = (kind: Medium, count: number): string =>
  count === 1 ? HIDDEN[kind].one : HIDDEN[kind].many;
