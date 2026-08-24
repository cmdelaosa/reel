import { describe, expect, it } from "vitest";
import { deriveMovieStatus } from "@/domain/movieStatus";

describe("deriveMovieStatus", () => {
  it("upcoming: no ha llegado su fecha de estreno", () => {
    expect(deriveMovieStatus({ airedCount: 0, watchedCount: 0 })).toBe("upcoming");
  });

  it("watchlist: estrenada y sin ver", () => {
    expect(deriveMovieStatus({ airedCount: 1, watchedCount: 0 })).toBe("watchlist");
  });

  it("watched: estrenada y vista", () => {
    expect(deriveMovieStatus({ airedCount: 1, watchedCount: 1 })).toBe("watched");
  });

  it("vista antes del estreno (pase, festival, un vuelo) sigue siendo vista", () => {
    expect(deriveMovieStatus({ airedCount: 0, watchedCount: 1 })).toBe("watched");
  });
});
