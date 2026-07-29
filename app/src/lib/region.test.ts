import { describe, expect, it } from "vitest";
import { COUNTRIES, airTimeZone, fmtPlainDate, hasRealAirTime } from "@/lib/region";
import { resetSettings, setSetting } from "@/lib/settings";

/* The country picker's contract: it decides which zone air times land in, and
   bare TMDB dates must stay put regardless of it. */

describe("airTimeZone", () => {
  it("defers to the device on 'auto' (undefined = the runtime's own zone)", () => {
    resetSettings();
    expect(airTimeZone()).toBeUndefined();
  });

  it("an explicit country overrides the device", () => {
    setSetting("country", "ES");
    expect(airTimeZone()).toBe("Europe/Madrid");
    setSetting("country", "JP");
    expect(airTimeZone()).toBe("Asia/Tokyo");
    resetSettings();
  });

  it("falls back to the device for a code we don't carry", () => {
    setSetting("country", "ZZ");
    expect(airTimeZone()).toBeUndefined();
    resetSettings();
  });
});

describe("COUNTRIES", () => {
  it("every entry has a resolvable IANA zone", () => {
    for (const c of COUNTRIES) {
      expect(() => new Date().toLocaleString("en-CA", { timeZone: c.tz })).not.toThrow();
    }
  });

  it("codes are unique ISO 3166-1 alpha-2 (also TMDB's watch/providers key)", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(codes).not.toContain("auto"); // reserved for the device option
  });
});

describe("fmtPlainDate", () => {
  it("keeps a bare TMDB date on its own day in a negative-offset zone", () => {
    // Date parses 'YYYY-MM-DD' as UTC midnight, so formatting it in New York
    // would otherwise render the 17th as the 16th.
    setSetting("country", "US");
    expect(fmtPlainDate("2011-04-17")).toMatch(/17/);
    resetSettings();
  });

  it("is unaffected by the chosen country", () => {
    setSetting("country", "JP");
    const jp = fmtPlainDate("2011-04-17");
    setSetting("country", "US");
    expect(fmtPlainDate("2011-04-17")).toBe(jp);
    resetSettings();
  });
});

describe("hasRealAirTime", () => {
  it("only TVmaze-sourced rows carry a printable clock", () => {
    expect(hasRealAirTime("tvmaze")).toBe(true);
    expect(hasRealAirTime("estimated")).toBe(false);
    expect(hasRealAirTime(null)).toBe(false);
    expect(hasRealAirTime(undefined)).toBe(false);
  });
});
