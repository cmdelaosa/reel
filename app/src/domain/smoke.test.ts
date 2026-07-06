import { describe, expect, it } from "vitest";
import { scaffoldOk } from "@/domain/smoke";

describe("scaffold", () => {
  it("wires up the domain layer and test runner", () => {
    expect(scaffoldOk()).toBe(true);
  });
});
