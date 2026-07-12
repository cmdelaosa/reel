import { describe, expect, it } from "vitest";
import { isPersistableMetadataKey } from "@/lib/queryPersistence";

describe("metadata query persistence", () => {
  it("persists only title and season metadata", () => {
    expect(isPersistableMetadataKey(["title", 42])).toBe(true);
    expect(isPersistableMetadataKey(["season", 42, 2])).toBe(true);
    expect(isPersistableMetadataKey(["watched", "user-title"])).toBe(false);
    expect(isPersistableMetadataKey(["myRating", "user-title"])).toBe(false);
    expect(isPersistableMetadataKey(["profile", "user"])).toBe(false);
  });
});
