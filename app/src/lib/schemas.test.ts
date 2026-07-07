import { describe, expect, it } from "vitest";
import {
  searchResponseSchema,
  titleResponseSchema,
  seasonResponseSchema,
} from "@/lib/schemas";
import search from "@/lib/__fixtures__/search.json";
import title from "@/lib/__fixtures__/title.json";
import season from "@/lib/__fixtures__/season.json";

/* Locks the tmdb-proxy response contract. Fixtures mirror the function's output
   shape; re-record from a live call once TMDB_API_KEY is available. */

describe("tmdb-proxy response schemas", () => {
  it("parses a search response", () => {
    const r = searchResponseSchema.parse(search);
    expect(r.results.length).toBe(2);
    expect(r.results[0].name).toBe("Severance");
  });

  it("parses a title response with seasons (incl. season 0 specials)", () => {
    const r = titleResponseSchema.parse(title);
    expect(r.title.network).toBe("Apple TV+");
    expect(r.seasons.map((s) => s.number)).toContain(0);
  });

  it("parses a season response with episodes (nullable overview allowed)", () => {
    const r = seasonResponseSchema.parse(season);
    expect(r.episodes.length).toBe(2);
    expect(r.episodes[1].overview).toBeNull();
  });

  it("rejects a malformed title row", () => {
    expect(() =>
      titleResponseSchema.parse({ title: { tmdb_id: "nope" }, seasons: [] }),
    ).toThrow();
  });
});
