import { describe, expect, it } from "vitest";
import { relativeTime } from "@/domain/time";

const now = new Date(2026, 6, 8, 20, 0); // Wed Jul 8 2026, 20:00 local
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M;

describe("relativeTime", () => {
  it("just now under 45s", () => {
    expect(relativeTime(ago(10 * S), now)).toBe("just now");
  });
  it("minutes", () => {
    expect(relativeTime(ago(2 * M), now)).toBe("2m ago");
    expect(relativeTime(ago(59 * M), now)).toBe("59m ago");
  });
  it("hours", () => {
    expect(relativeTime(ago(2 * H), now)).toBe("2h ago");
    expect(relativeTime(ago(23 * H), now)).toBe("23h ago");
  });
  it("yesterday for the prior calendar day", () => {
    // 26h ago crosses into yesterday
    expect(relativeTime(ago(26 * H), now)).toBe("yesterday");
    // same-calendar-day but >24h is impossible; 25h from 20:00 = 19:00 prev day
    expect(relativeTime(new Date(2026, 6, 7, 10, 0).toISOString(), now)).toBe("yesterday");
  });
  it("N days ago within a week", () => {
    expect(relativeTime(new Date(2026, 6, 5, 12, 0).toISOString(), now)).toBe("3 days ago");
  });
  it("short date beyond a week", () => {
    expect(relativeTime(new Date(2026, 5, 20, 12, 0).toISOString(), now)).toMatch(/Jun\s*20/);
  });
});
