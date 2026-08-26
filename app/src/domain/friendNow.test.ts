import { describe, expect, it } from "vitest";
import {
  friendActivityOf, friendActivityVerb, lastWatched, mediaFirst, playingNow,
  type FriendGameRow, type FriendWatchRow,
} from "@/domain/friendNow";

const game = (over: Partial<FriendGameRow> & { tmdb_id: number }): FriendGameRow => ({
  kind: "game",
  first_air_date: "2020-01-01",
  added_at: "2026-01-01T00:00:00Z",
  ...over,
});

const watch = (kind: FriendWatchRow["kind"], tmdb_id: number, watched_at: string): FriendWatchRow =>
  ({ kind, tmdb_id, watched_at });

describe("friendActivityVerb", () => {
  it("cada estado tiene su verbo, y ninguno es el de otro medio", () => {
    expect(friendActivityVerb("watching")).toBe("friends: Watching");
    expect(friendActivityVerb("just-watched")).toBe("friends: Just watched");
    expect(friendActivityVerb("playing")).toBe("friends: Playing");
    expect(friendActivityVerb("just-finished")).toBe("friends: Just finished");
  });
});

describe("friendActivityOf", () => {
  it("manda lo que diga el servidor", () => {
    expect(friendActivityOf("just-finished", "game")).toBe("just-finished");
    expect(friendActivityOf("just-watched", "tv")).toBe("just-watched");
  });

  it("sin columna —el hueco entre 0084 y el frontend— cae al verbo del medio", () => {
    expect(friendActivityOf(null, "tv")).toBe("watching");
    expect(friendActivityOf(undefined, "movie")).toBe("just-watched");
    expect(friendActivityOf(null, "game")).toBe("playing");
  });

  it("un estado que no conozco no se pinta tal cual", () => {
    expect(friendActivityOf("reading", "tv")).toBe("watching");
  });
});

describe("playingNow", () => {
  const none = new Set<number>();

  it("solo juegos: una serie con el mismo número no se cuela", () => {
    const rows = [
      { ...game({ tmdb_id: 7, play_state: "playing" }) },
      { ...game({ tmdb_id: 7, play_state: "playing" }), kind: "tv" as const },
    ];
    expect(playingNow(rows, none).map((r) => r.kind)).toEqual(["game"]);
  });

  it("lo que dijo a mano es lo que se enseña, y 'sin final' también es jugarlo", () => {
    const rows = [
      game({ tmdb_id: 1, play_state: "playing" }),
      game({ tmdb_id: 2, play_state: "ongoing" }),
      game({ tmdb_id: 3, play_state: "dropped" }),
      game({ tmdb_id: 4, play_state: "backlog" }),
      game({ tmdb_id: 5 }),
    ];
    expect(playingNow(rows, none).map((r) => r.tmdb_id).sort()).toEqual([1, 2]);
  });

  it("terminado deja de ser jugando aunque la etiqueta siga puesta", () => {
    const rows = [game({ tmdb_id: 1, play_state: "playing" })];
    expect(playingNow(rows, new Set([1]))).toEqual([]);
  });

  it("lo más reciente primero, por played_at", () => {
    const rows = [
      game({ tmdb_id: 1, play_state: "playing", played_at: "2026-08-01T00:00:00Z" }),
      game({ tmdb_id: 2, play_state: "playing", played_at: "2026-08-20T00:00:00Z" }),
    ];
    expect(playingNow(rows, none).map((r) => r.tmdb_id)).toEqual([2, 1]);
  });

  it("sin played_at ordena por cuándo lo añadió — las filas de antes de 0075", () => {
    const rows = [
      game({ tmdb_id: 1, play_state: "playing", added_at: "2026-01-01T00:00:00Z" }),
      game({ tmdb_id: 2, play_state: "playing", added_at: "2026-07-01T00:00:00Z" }),
      game({ tmdb_id: 3, play_state: "playing", played_at: "2026-08-25T00:00:00Z", added_at: "2020-01-01T00:00:00Z" }),
    ];
    expect(playingNow(rows, none).map((r) => r.tmdb_id)).toEqual([3, 2, 1]);
  });

  it("un juego sin salir que ya está jugando cuenta — lo dicho manda sobre la fecha", () => {
    const rows = [game({ tmdb_id: 1, play_state: "playing", first_air_date: "2027-01-01" })];
    expect(playingNow(rows, none, new Date("2026-08-26T00:00:00Z")).map((r) => r.tmdb_id)).toEqual([1]);
  });

  it("recorta al límite", () => {
    const rows = Array.from({ length: 20 }, (_, i) => game({ tmdb_id: i, play_state: "playing" }));
    expect(playingNow(rows, none).length).toBe(12);
  });
});

describe("lastWatched", () => {
  it("solo el medio pedido", () => {
    const rows = [watch("movie", 1, "2026-08-20T00:00:00Z"), watch("tv", 2, "2026-08-21T00:00:00Z")];
    expect(lastWatched(rows, "movie").map((r) => r.tmdb_id)).toEqual([1]);
  });

  it("una temporada entera es UNA fila, y con su evento más reciente", () => {
    const rows = [
      watch("tv", 9, "2026-08-01T00:00:00Z"),
      watch("tv", 9, "2026-08-10T00:00:00Z"),
      watch("tv", 8, "2026-08-05T00:00:00Z"),
    ];
    const out = lastWatched(rows, "tv");
    expect(out.map((r) => r.tmdb_id)).toEqual([9, 8]);
    expect(out[0].watched_at).toBe("2026-08-10T00:00:00Z");
  });

  it("no depende de que la lista llegue ordenada", () => {
    const rows = [
      watch("movie", 1, "2026-01-01T00:00:00Z"),
      watch("movie", 2, "2026-08-01T00:00:00Z"),
    ];
    expect(lastWatched(rows, "movie").map((r) => r.tmdb_id)).toEqual([2, 1]);
  });

  it("recorta al límite", () => {
    const rows = Array.from({ length: 10 }, (_, i) => watch("movie", i, `2026-08-0${i % 9}T00:00:00Z`));
    expect(lastWatched(rows, "movie").length).toBe(6);
  });
});

describe("mediaFirst", () => {
  it("delante el del conmutador, el resto en el orden de siempre", () => {
    expect(mediaFirst("game")).toEqual(["game", "tv", "movie"]);
    expect(mediaFirst("movie")).toEqual(["movie", "tv", "game"]);
    expect(mediaFirst("tv")).toEqual(["tv", "movie", "game"]);
  });

  it("están los tres, sin repetir", () => {
    expect(new Set(mediaFirst("game")).size).toBe(3);
  });
});
