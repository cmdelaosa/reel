import { describe, expect, it } from "vitest";
import { byEvent, chipsFor, myEmoji, nameList, REACTIONS, type ReactionRow } from "./reactions";

const row = (over: Partial<ReactionRow> & { emoji: string; user_id: string }): ReactionRow => ({
  event_key: "w:actor:title:2026-07-31",
  display_name: over.user_id,
  avatar_url: null,
  created_at: "2026-07-31T10:00:00Z",
  ...over,
});

describe("byEvent", () => {
  it("keeps each event's rows in the order they arrived", () => {
    const a = row({ emoji: "🔥", user_id: "ana", event_key: "e1" });
    const b = row({ emoji: "😂", user_id: "leo", event_key: "e2" });
    const c = row({ emoji: "💩", user_id: "leo", event_key: "e1" });
    const map = byEvent([a, b, c]);
    expect(map.get("e1")).toEqual([a, c]);
    expect(map.get("e2")).toEqual([b]);
    expect(map.get("nope")).toBeUndefined();
  });
});

describe("chipsFor", () => {
  it("counts each emoji once, with everyone behind it", () => {
    const chips = chipsFor(
      [row({ emoji: "🔥", user_id: "ana" }), row({ emoji: "🔥", user_id: "leo" })],
      "carlos",
    );
    expect(chips).toEqual([{ emoji: "🔥", count: 2, names: ["ana", "leo"], mine: false }]);
  });

  it("lights the chip the caller is part of", () => {
    const chips = chipsFor(
      [row({ emoji: "🔥", user_id: "ana" }), row({ emoji: "💩", user_id: "carlos" })],
      "carlos",
    );
    expect(chips.map((c) => [c.emoji, c.mine])).toEqual([["🔥", false], ["💩", true]]);
  });

  it("orders chips by the palette, not by who reacted first", () => {
    const chips = chipsFor(
      [row({ emoji: "💩", user_id: "ana" }), row({ emoji: "❤️", user_id: "leo" }), row({ emoji: "😱", user_id: "max" })],
      "carlos",
    );
    expect(chips.map((c) => c.emoji)).toEqual(["❤️", "😱", "💩"]);
  });

  it("keeps an emoji from outside the palette, after the known ones", () => {
    const chips = chipsFor(
      [row({ emoji: "🦄", user_id: "ana" }), row({ emoji: "🔥", user_id: "leo" })],
      "carlos",
    );
    expect(chips.map((c) => c.emoji)).toEqual(["🔥", "🦄"]);
  });

  it("has nothing to show for no reactions", () => {
    expect(chipsFor([], "carlos")).toEqual([]);
  });
});

describe("myEmoji", () => {
  it("finds the caller's own reaction, or nothing", () => {
    const rows = [row({ emoji: "🔥", user_id: "ana" }), row({ emoji: "🍿", user_id: "carlos" })];
    expect(myEmoji(rows, "carlos")).toBe("🍿");
    expect(myEmoji(rows, "leo")).toBeNull();
  });
});

describe("nameList", () => {
  const pair = (a: string, b: string) => `${a} y ${b}`;
  const overflow = (a: string, n: number) => `${a} y ${n} más`;

  it("names one, pairs two, and counts the rest", () => {
    expect(nameList([], pair, overflow)).toBe("");
    expect(nameList(["Ana"], pair, overflow)).toBe("Ana");
    expect(nameList(["Ana", "Leo"], pair, overflow)).toBe("Ana y Leo");
    expect(nameList(["Ana", "Leo", "Max", "Rubén"], pair, overflow)).toBe("Ana y 3 más");
  });
});

describe("REACTIONS", () => {
  it("is the seven-emoji palette the DB constraint allows", () => {
    expect(REACTIONS).toEqual(["❤️", "🔥", "😂", "😱", "🍿", "💤", "💩"]);
    expect(new Set(REACTIONS).size).toBe(REACTIONS.length);
  });
});
