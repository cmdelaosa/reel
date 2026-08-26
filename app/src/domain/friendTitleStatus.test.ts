import { describe, expect, it } from "vitest";
import {
  friendGameLabel,
  friendGameStatus,
  friendMovieLabel,
  friendMovieStatus,
  type FriendTitleInput,
} from "@/domain/friendTitleStatus";
import { deriveGameStatus } from "@/domain/gameStatus";
import { deriveMovieStatus } from "@/domain/movieStatus";

const base: FriendTitleInput = { entry: null, finished: false, released: true };

describe("friendMovieStatus", () => {
  it("no dice nada de quien ni la sigue ni la ha visto", () => {
    expect(friendMovieStatus(base)).toBeNull();
  });

  it("la que sigue y no ha visto la tiene pendiente", () => {
    expect(friendMovieStatus({ ...base, entry: { followed: true } })).toBe("watchlist");
  });

  it("vista cuenta aunque no la siga — así llega una importación", () => {
    expect(friendMovieStatus({ ...base, entry: null, finished: true })).toBe("watched");
  });

  it("vista manda sobre el estreno", () => {
    expect(friendMovieStatus({ entry: { followed: true }, finished: true, released: false })).toBe("watched");
  });

  it("la que sigue y no ha salido es un próximo estreno", () => {
    expect(friendMovieStatus({ ...base, entry: { followed: true }, released: false })).toBe("upcoming");
  });
});

describe("friendGameStatus", () => {
  it("no dice nada de quien ni lo sigue ni lo ha terminado", () => {
    expect(friendGameStatus(base)).toBeNull();
  });

  it("lo que dijo a mano manda", () => {
    expect(friendGameStatus({ ...base, entry: { followed: true, playState: "playing" } })).toBe("playing");
  });

  it("terminado manda sobre lo que dijo a mano", () => {
    expect(
      friendGameStatus({ ...base, entry: { followed: true, playState: "playing" }, finished: true }),
    ).toBe("finished");
  });

  /* La regla de 0076, que es justo la que se rompía si este módulo derivase por
     su cuenta: un juego suyo con 0 h es inventario, no un pendiente. */
  it("lo suyo sin tocar es 'lo tengo' y no 'pendiente'", () => {
    expect(friendGameStatus({ ...base, entry: { followed: true, owned: true, minutesPlayed: 0 } })).toBe("owned");
    expect(friendGameStatus({ ...base, entry: { followed: true, owned: true, minutesPlayed: 90 } })).toBe("backlog");
  });

  /* Que no reimplemente la derivación es media razón de existir del módulo: si
     alguien cambia deriveGameStatus, la ficha de un amigo cambia con él. */
  it("delega en la derivación de tu biblioteca", () => {
    const entry = { followed: true, playState: "dropped" as const, owned: true, minutesPlayed: 12 };
    expect(friendGameStatus({ entry, finished: false, released: true })).toBe(
      deriveGameStatus({ airedCount: 1, watchedCount: 0, playState: "dropped", owned: true, minutesPlayed: 12 }),
    );
    expect(friendMovieStatus({ entry: { followed: true }, finished: false, released: false })).toBe(
      deriveMovieStatus({ airedCount: 0, watchedCount: 0 }),
    );
  });
});

describe("las palabras", () => {
  it("cada estado tiene la suya, y llevan prefijo para no pisar las de los cubos", () => {
    for (const s of ["upcoming", "watchlist", "watched"] as const) {
      expect(friendMovieLabel(s)).toMatch(/^friend: /);
    }
    for (const s of ["upcoming", "backlog", "owned", "playing", "ongoing", "finished", "dropped"] as const) {
      expect(friendGameLabel(s)).toMatch(/^friend: /);
    }
  });
});
