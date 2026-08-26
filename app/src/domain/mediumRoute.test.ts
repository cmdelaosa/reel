import { describe, expect, it } from "vitest";
import { HOME, routeForMedium, sectionOfPath, type Section } from "@/domain/mediumRoute";
import type { Medium } from "@/domain/mediumCopy";

/* Lo que estas pruebas sostienen es una sola frase: cambiar de modo cambia de
   MEDIO, no de sección. Si estabas explorando juegos y pulsas Series, sigues
   explorando.

   Y su excepción, que es la mitad que se rompe sola cuando alguien añada la
   quinta pestaña de un modo: lo que solo existe en un medio —Steam— no tiene
   adónde cruzar, y cae en la portada en vez de en una ruta inventada. */

const MEDIA: Medium[] = ["tv", "movie", "game"];

/** Las doce, escritas a mano y no leídas de la tabla: una prueba que se
 *  construye con la misma expresión que el código no prueba nada. */
const RUTAS: Record<Section, Record<Medium, string>> = {
  tonight: { tv: "/tonight", movie: "/movies/tonight", game: "/games/tonight" },
  calendar: { tv: "/calendar", movie: "/movies/releases", game: "/games/releases" },
  library: { tv: "/shows?filter=watchlist", movie: "/movies/watchlist", game: "/games/backlog" },
  explore: { tv: "/explore", movie: "/movies/explore", game: "/games/explore" },
};

describe("sectionOfPath", () => {
  for (const [section, byMedium] of Object.entries(RUTAS) as [Section, Record<Medium, string>][]) {
    for (const [medium, ruta] of Object.entries(byMedium) as [Medium, string][]) {
      it(`${ruta} es ${section} (${medium})`, () => {
        expect(sectionOfPath(ruta.split("?")[0])).toBe(section);
      });
    }
  }

  it("una ruta hija cuenta como su sección", () => {
    expect(sectionOfPath("/shows/1399")).toBe("library");
  });

  it("Steam no es de ninguna sección: solo existe en juegos", () => {
    expect(sectionOfPath("/games/steam")).toBeNull();
  });

  it("las páginas compartidas tampoco", () => {
    expect(sectionOfPath("/friends")).toBeNull();
    expect(sectionOfPath("/you")).toBeNull();
    expect(sectionOfPath("/history")).toBeNull();
  });

  it("el prefijo de un modo a secas no es una sección: es una redirección", () => {
    expect(sectionOfPath("/movies")).toBeNull();
    expect(sectionOfPath("/games")).toBeNull();
  });
});

describe("routeForMedium", () => {
  /* La matriz entera: desde cada una de las doce, hacia cada uno de los tres
     modos. Es lo que hace que añadir una sección sin darle su fila se note. */
  for (const [section, byMedium] of Object.entries(RUTAS) as [Section, Record<Medium, string>][]) {
    for (const desde of MEDIA) {
      for (const hacia of MEDIA) {
        it(`${section}: de ${desde} a ${hacia}`, () => {
          expect(routeForMedium(byMedium[desde].split("?")[0], hacia)).toBe(byMedium[hacia]);
        });
      }
    }
  }

  it("explorar juegos y pulsar Series lleva a explorar series", () => {
    expect(routeForMedium("/games/explore", "tv")).toBe("/explore");
  });

  it("Pendientes lleva a la biblioteca del otro medio, con su cubo puesto", () => {
    expect(routeForMedium("/games/backlog", "tv")).toBe("/shows?filter=watchlist");
    expect(routeForMedium("/games/backlog", "movie")).toBe("/movies/watchlist");
  });

  it("desde Steam se cae en la portada, no en una ruta inventada", () => {
    expect(routeForMedium("/games/steam", "tv")).toBe(HOME.tv);
    expect(routeForMedium("/games/steam", "movie")).toBe(HOME.movie);
  });

  it("desde una ruta que no es de ningún medio, la portada", () => {
    expect(routeForMedium("/collection/lo-mejor-de-2026", "game")).toBe(HOME.game);
  });

  it("ir y volver deja donde estabas", () => {
    const ida = routeForMedium("/movies/releases", "game");
    expect(routeForMedium(ida, "movie")).toBe("/movies/releases");
  });
});
