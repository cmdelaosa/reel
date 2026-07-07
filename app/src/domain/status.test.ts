import { describe, expect, it } from "vitest";
import { deriveStatus, watchProgress } from "@/domain/status";

describe("deriveStatus", () => {
  it("upcoming: nothing aired yet", () => {
    expect(deriveStatus({ airedCount: 0, watchedCount: 0, tmdbStatus: "Returning Series" })).toBe("upcoming");
  });

  it("upcoming beats everything when A == 0 even if TMDB says Ended", () => {
    expect(deriveStatus({ airedCount: 0, watchedCount: 0, tmdbStatus: "Ended" })).toBe("upcoming");
  });

  it("watchlist: aired but nothing watched", () => {
    expect(deriveStatus({ airedCount: 8, watchedCount: 0, tmdbStatus: null })).toBe("watchlist");
  });

  it("watching: some but not all aired watched", () => {
    expect(deriveStatus({ airedCount: 8, watchedCount: 3, tmdbStatus: "Returning Series" })).toBe("watching");
  });

  it("caughtup: all aired watched, show still returning", () => {
    expect(deriveStatus({ airedCount: 8, watchedCount: 8, tmdbStatus: "Returning Series" })).toBe("caughtup");
  });

  it("finished: all watched and TMDB Ended / Canceled", () => {
    expect(deriveStatus({ airedCount: 62, watchedCount: 62, tmdbStatus: "Ended" })).toBe("finished");
    expect(deriveStatus({ airedCount: 10, watchedCount: 10, tmdbStatus: "Canceled" })).toBe("finished");
  });

  it("caughtup when fully watched but status unknown", () => {
    expect(deriveStatus({ airedCount: 5, watchedCount: 5, tmdbStatus: null })).toBe("caughtup");
  });

  it("tolerates watched > aired (imports counting specials TMDB lacks)", () => {
    expect(deriveStatus({ airedCount: 10, watchedCount: 12, tmdbStatus: "Returning Series" })).toBe("caughtup");
    expect(watchProgress({ airedCount: 10, watchedCount: 12 })).toBe(100);
  });
});

describe("watchProgress", () => {
  it("rounds watched/aired", () => {
    expect(watchProgress({ airedCount: 3, watchedCount: 1 })).toBe(33);
    expect(watchProgress({ airedCount: 8, watchedCount: 8 })).toBe(100);
    expect(watchProgress({ airedCount: 0, watchedCount: 0 })).toBe(0);
  });
});
