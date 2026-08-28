import { describe, expect, it } from "vitest";
import { MEDIA, type Medium } from "@/domain/tasteScope";
import {
  ratingsEmpty,
  ratingsRoute,
  ratingsSummary,
  ratingsSummaryLine,
  ratingsTitle,
  sortRatings,
  type RateSort,
} from "@/domain/ratingsList";

const note = (name: string, score: number, created_at: string) => ({ name, score, created_at });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

/* Tres notas con tres fechas y tres puntuaciones distintas, para que cada orden
   dé una lista distinta y ninguna prueba pase por casualidad. */
const rows = [
  note("Vieja y buena", 9, "2015-03-01T10:00:00Z"),
  note("Nueva y regular", 6, "2026-08-01T10:00:00Z"),
  note("Media", 7, "2020-06-01T10:00:00Z"),
];

describe("sortRatings", () => {
  const casos: [RateSort, string[]][] = [
    ["new", ["Nueva y regular", "Media", "Vieja y buena"]],
    ["old", ["Vieja y buena", "Media", "Nueva y regular"]],
    ["best", ["Vieja y buena", "Media", "Nueva y regular"]],
    ["worst", ["Nueva y regular", "Media", "Vieja y buena"]],
  ];
  it.each(casos)("%s ordena como promete", (sort, esperado) => {
    expect(names(sortRatings(rows, sort))).toEqual(esperado);
  });

  it("no toca el array que recibe", () => {
    const original = [...rows];
    sortRatings(rows, "best");
    expect(rows).toEqual(original);
  });

  /* La importación de FilmAffinity sella cientos de notas con el mismo
     instante. Entre ellas manda el orden en el que llegan —que la consulta ya
     hace total con `title_id`—, y no el capricho del `sort`. */
  it("mismo instante: se respeta el orden de llegada", () => {
    const mismas = [
      note("Primera", 8, "2019-01-01T00:00:00Z"),
      note("Segunda", 8, "2019-01-01T00:00:00Z"),
      note("Tercera", 8, "2019-01-01T00:00:00Z"),
    ];
    expect(names(sortRatings(mismas, "new"))).toEqual(["Primera", "Segunda", "Tercera"]);
    expect(names(sortRatings(mismas, "best"))).toEqual(["Primera", "Segunda", "Tercera"]);
  });

  /* Misma nota, distinta fecha: el desempate de "mejor/peor" es la fecha, o dos
     nueves se ordenarían al azar dentro de su empate. */
  it("empate de puntuación: desempata la fecha, la nueva primero", () => {
    const nueves = [
      note("Antigua", 9, "2015-03-01T10:00:00Z"),
      note("Reciente", 9, "2026-08-01T10:00:00Z"),
    ];
    expect(names(sortRatings(nueves, "best"))).toEqual(["Reciente", "Antigua"]);
    expect(names(sortRatings(nueves, "worst"))).toEqual(["Reciente", "Antigua"]);
  });

  it("sin notas no revienta", () => {
    expect(sortRatings([], "new")).toEqual([]);
  });
});

describe("ratingsSummary", () => {
  const mezcla = [
    { score: 8, kind: "tv" as Medium },
    { score: 6, kind: "tv" as Medium },
    { score: 9, kind: "movie" as Medium },
  ];

  it("cuenta y promedia cada medio por separado", () => {
    const s = ratingsSummary(mezcla);
    expect(s.tv).toEqual({ count: 2, avg: 7 });
    expect(s.movie).toEqual({ count: 1, avg: 9 });
  });

  /* Sin notas de un medio la media es null y no 0: la tarjeta esconde el vacío,
     y un 0,0 diría que puntúas fatal lo que no has puntuado. */
  it("un medio sin notas: cero y media nula", () => {
    expect(ratingsSummary(mezcla).game).toEqual({ count: 0, avg: null });
  });

  it("responde por los tres medios aunque solo llegue uno", () => {
    expect(Object.keys(ratingsSummary([{ score: 5, kind: "game" }]))).toEqual([...MEDIA]);
  });

  /* La razón de que el bucle mire `total.get` antes de sumar: una fila con un
     `kind` que este cliente no conoce —un medio nuevo servido a un frontend
     viejo— no puede colarse en la media de las series. */
  it("un medio desconocido no infla la media de nadie", () => {
    const s = ratingsSummary([
      { score: 8, kind: "tv" },
      { score: 2, kind: "book" as unknown as Medium },
    ]);
    expect(s.tv).toEqual({ count: 1, avg: 8 });
  });
});

describe("las palabras y el sitio de cada medio", () => {
  /* Las cuatro tablas son `Record<Medium, …>`, así que un medio nuevo no
     compila sin sus frases. Esto vigila lo que el tipo no ve: que ninguna de
     las tres comparta texto con otra —copiar la fila de al lado y olvidar
     cambiarla es exactamente el fallo que las tablas existen para evitar—. */
  it.each([
    ["título", ratingsTitle],
    ["resumen en singular", (m: Medium) => ratingsSummaryLine(m, 1)],
    ["resumen en plural", (m: Medium) => ratingsSummaryLine(m, 812)],
    ["vacío", ratingsEmpty],
    ["ruta", ratingsRoute],
  ])("%s: uno distinto por medio", (_que, fn) => {
    expect(new Set(MEDIA.map((m) => fn(m))).size).toBe(MEDIA.length);
  });

  /* Una nota sola es el caso de quien acaba de empezar, y es justo el que se ve
     en la tarjeta del perfil el primer día: "1 series puntuadas" no. */
  it("una nota: la frase va en singular", () => {
    for (const m of MEDIA) expect(ratingsSummaryLine(m, 1)).not.toBe(ratingsSummaryLine(m, 2));
  });

  it("el resumen lleva los dos huecos que la tarjeta rellena", () => {
    for (const m of MEDIA) {
      for (const n of [1, 812]) {
        expect(ratingsSummaryLine(m, n)).toContain("{n}");
        expect(ratingsSummaryLine(m, n)).toContain("{avg}");
      }
    }
  });

  /* Estas rutas cuelgan del perfil a propósito: son tuyas, no del modo en el
     que estés, y colgarlas de /movies o /games teñiría la barra y cambiaría las
     pestañas al entrar (lib/medium, `mediumOfPath`). */
  it("todas cuelgan de /you/ratings", () => {
    for (const m of MEDIA) expect(ratingsRoute(m)).toMatch(/^\/you\/ratings\//);
  });
});
