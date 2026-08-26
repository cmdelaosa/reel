/* Adónde te lleva cambiar de modo. Puro, con tests al lado
   (mediumRoute.test.ts).

   El conmutador de la barra hacía siempre lo mismo: te dejaba en la portada del
   modo nuevo, vinieras de donde vinieras. Con dos modos y cuatro pantallas se
   notaba poco; con tres modos y cinco, cambiar de medio desde Explorar para
   seguir explorando costaba dos clics, y el segundo siempre era el mismo. Lo
   que se guarda al cruzar no es la pantalla —una pantalla de juegos no existe
   en cine— sino la SECCIÓN, que es la pregunta que estabas haciendo.

   Vive en domain y no en el Shell por lo de siempre: es una tabla de
   equivalencias entre tres modos que hay que poder leer entera de un vistazo y
   probar sin montar un router. */

import type { Medium } from "@/domain/mediumCopy";

/** Las cuatro secciones que existen en los tres modos. Steam no está: es de
 *  juegos y de nadie más, así que cruzar desde ella cae en la portada. */
export type Section = "tonight" | "calendar" | "library" | "explore";

/* La tabla. Cada fila es LA MISMA pregunta dicha en los tres medios, aunque la
   pestaña que lleva a ella se llame distinto en cada uno — "Calendario",
   "Estrenos" y "Lanzamientos" son la misma sección, y por eso están en la misma
   fila.

   La biblioteca de series lleva el `?filter=watchlist` que lleva su pestaña, y
   no `/shows` a secas: el cubo que abre —lo que no has empezado— es el
   equivalente honesto de "Pendientes" en juegos, que es de donde más se va a
   venir. */
const ROUTES: Record<Section, Record<Medium, string>> = {
  tonight: { tv: "/tonight", movie: "/movies/tonight", game: "/games/tonight" },
  calendar: { tv: "/calendar", movie: "/movies/releases", game: "/games/releases" },
  library: { tv: "/shows?filter=watchlist", movie: "/movies/watchlist", game: "/games/backlog" },
  explore: { tv: "/explore", movie: "/movies/explore", game: "/games/explore" },
};

/** La portada de cada modo, adonde te lleva el conmutador cuando la sección en
 *  la que estás no existe al otro lado. Los tres son ya su "esta noche": es la
 *  pantalla que responde la pregunta con la que se abre la app. */
export const HOME: Record<Medium, string> = ROUTES.tonight;

/* Las doce rutas con su sección, ordenadas de más larga a más corta para que
   una ruta que sea prefijo de otra no se coma a la larga. Hoy ninguna lo es
   —`/tonight` y `/movies/tonight` no se solapan—, pero la tabla de arriba está
   hecha para crecer y este orden es lo que hace que crecer salga gratis. */
const ENTRIES: ReadonlyArray<readonly [string, Section]> = Object.entries(ROUTES)
  .flatMap(([section, byMedium]) =>
    Object.values(byMedium).map((route) => [route.split("?")[0], section as Section] as const),
  )
  .sort((a, b) => b[0].length - a[0].length);

/** En qué sección estás, o null si la ruta no es de ninguna — Amigos, tu
 *  perfil, el historial, Steam. */
export function sectionOfPath(pathname: string): Section | null {
  for (const [route, section] of ENTRIES) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return section;
  }
  return null;
}

/** La ruta a la que ir al cambiar a `next` desde `pathname`: la misma sección
 *  si existe al otro lado, y la portada si no. */
export function routeForMedium(pathname: string, next: Medium): string {
  const section = sectionOfPath(pathname);
  return section ? ROUTES[section][next] : HOME[next];
}
