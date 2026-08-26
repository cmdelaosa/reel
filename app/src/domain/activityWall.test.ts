import { describe, expect, it } from "vitest";
import { buildWall, type AddedEvent, type RatingEvent, type WatchEvent } from "@/domain/activityWall";
import type { Medium } from "@/domain/mediumCopy";

/* Lo que sostienen estas pruebas es el plegado, que es lo único que este módulo
   añade sobre "juntar tres listas y ordenarlas". Sin él, la importación de
   InfiniteBacklog son 386 filas idénticas y la actividad real de la persona
   queda enterrada debajo. */

const watch = (at: string, season: number, episode: number, kind: Medium = "tv", tmdb_id = 1399): WatchEvent =>
  ({ at, kind, tmdb_id, name: "Severance", poster_path: null, season_number: season, episode_number: episode });

const add = (at: string, kind: Medium, tmdb_id: number, owned = false): AddedEvent =>
  ({ at, kind, tmdb_id, name: `t${tmdb_id}`, poster_path: null, owned });

const rate = (at: string, score: number, tmdb_id = 1): RatingEvent =>
  ({ at, kind: "tv", tmdb_id, name: `t${tmdb_id}`, poster_path: null, score });

describe("buildWall · lo visto", () => {
  it("pliega los episodios del mismo día en una fila con su rango", () => {
    const wall = buildWall({
      watched: [
        watch("2026-08-20T10:00:00Z", 1, 3),
        watch("2026-08-20T10:30:00Z", 1, 4),
        watch("2026-08-20T14:00:00Z", 1, 5),
      ],
    });
    expect(wall).toHaveLength(1);
    expect(wall[0].count).toBe(3);
    expect(wall[0].from).toEqual({ season: 1, episode: 3 });
    expect(wall[0].to).toEqual({ season: 1, episode: 5 });
  });

  it("el rango sale bien aunque los episodios lleguen desordenados", () => {
    const wall = buildWall({
      watched: [watch("2026-08-20T14:00:00Z", 2, 1), watch("2026-08-20T10:00:00Z", 1, 8)],
    });
    expect(wall[0].from).toEqual({ season: 1, episode: 8 });
    expect(wall[0].to).toEqual({ season: 2, episode: 1 });
  });

  it("dos días distintos son dos filas", () => {
    const wall = buildWall({
      watched: [watch("2026-08-20T10:00:00Z", 1, 1), watch("2026-08-21T10:00:00Z", 1, 2)],
    });
    expect(wall).toHaveLength(2);
  });

  it("ni el cine ni los juegos traen rango de episodios", () => {
    // El S1E1 sintético de 0067 y 0071 llega en la fila, y componer un rango
    // para tirarlo deja el código afirmando lo que la vista niega.
    const wall = buildWall({
      watched: [watch("2026-08-20T10:00:00Z", 1, 1, "movie", 27205), watch("2026-08-20T14:00:00Z", 1, 1, "game", 5000)],
    });
    expect(wall.every((i) => i.from === undefined && i.to === undefined)).toBe(true);
  });

  it("un título de cada medio con el mismo número son filas distintas", () => {
    // La trampa de siempre: un tmdb_id solo es único dentro de su medio.
    const wall = buildWall({
      watched: [watch("2026-08-20T10:00:00Z", 1, 1, "tv", 1399), watch("2026-08-20T10:00:00Z", 1, 1, "movie", 1399)],
    });
    expect(wall).toHaveLength(2);
  });
});

describe("buildWall · lo añadido", () => {
  it("una importación entera es UNA fila", () => {
    const wall = buildWall({
      added: Array.from({ length: 386 }, (_, i) => add("2026-08-20T14:00:00Z", "game", i)),
    });
    expect(wall).toHaveLength(1);
    expect(wall[0].count).toBe(386);
    expect(wall[0].list).toBe("backlog");
  });

  it("el medio entra en la clave del grupo, no solo la lista", () => {
    // Series y cine comparten watchlist: sin el medio, tres series y dos pelis
    // del mismo día salían como "cinco series".
    const wall = buildWall({
      added: [add("2026-08-20T10:00:00Z", "tv", 1), add("2026-08-20T14:00:00Z", "movie", 2)],
    });
    expect(wall).toHaveLength(2);
    expect(wall.map((i) => i.count)).toEqual([1, 1]);
  });

  it("lo marcado 'Lo tengo' va a la biblioteca y no a pendientes", () => {
    const wall = buildWall({
      added: [add("2026-08-20T10:00:00Z", "game", 1, true), add("2026-08-20T14:00:00Z", "game", 2, false)],
    });
    expect(wall.find((i) => i.list === "library")?.count).toBe(1);
    expect(wall.find((i) => i.list === "backlog")?.count).toBe(1);
  });

  it("el representante del grupo es el más reciente del día", () => {
    const wall = buildWall({
      added: [add("2026-08-20T10:00:00Z", "game", 1), add("2026-08-20T14:00:00Z", "game", 99)],
    });
    expect(wall[0].count).toBe(2);
    expect(wall[0].tmdb_id).toBe(99);
  });
});

describe("buildWall · el conjunto", () => {
  it("las notas no se pliegan: cada una es una decisión suya", () => {
    const wall = buildWall({ rated: [rate("2026-08-20T10:00:00Z", 8, 1), rate("2026-08-20T10:05:00Z", 4, 2)] });
    expect(wall).toHaveLength(2);
  });

  it("ordena de lo más reciente a lo más antiguo, mezclando verbos", () => {
    const wall = buildWall({
      watched: [watch("2026-08-19T10:00:00Z", 1, 1)],
      rated: [rate("2026-08-21T10:00:00Z", 9)],
      added: [add("2026-08-20T10:00:00Z", "movie", 3)],
    });
    expect(wall.map((i) => i.verb)).toEqual(["rated", "added", "watched"]);
  });

  it("dos hechos del mismo instante salen siempre en el mismo orden", () => {
    // Una importación escribe cientos con la misma marca de tiempo; sin
    // desempate el muro baila entre renders de los mismos datos.
    const a = buildWall({ rated: [rate("2026-08-20T10:00:00Z", 8, 2), rate("2026-08-20T10:00:00Z", 8, 1)] });
    const b = buildWall({ rated: [rate("2026-08-20T10:00:00Z", 8, 1), rate("2026-08-20T10:00:00Z", 8, 2)] });
    expect(a.map((i) => i.key)).toEqual(b.map((i) => i.key));
  });

  it("respeta el tope de filas", () => {
    const wall = buildWall({ rated: Array.from({ length: 50 }, (_, i) => rate(`2026-08-20T10:00:${String(i).padStart(2, "0")}Z`, 7, i)) }, { limit: 10 });
    expect(wall).toHaveLength(10);
  });

  it("sin nada que contar devuelve una lista vacía, no una fila fantasma", () => {
    expect(buildWall({})).toEqual([]);
  });
});
