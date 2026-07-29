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
    setSetting("country", "DE");
    expect(airTimeZone()).toBe("Europe/Berlin");
    setSetting("country", "CH");
    expect(airTimeZone()).toBe("Europe/Zurich");
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
  // Date parses 'YYYY-MM-DD' as UTC midnight, so the formatter pins UTC too —
  // run it through a negative-offset zone and a premiere dated the 17th renders
  // as the 16th. No country in the picker is west of UTC today, but the device
  // zone can be anything, so the guarantee has to hold independently of both.
  it("keeps a bare TMDB date on its own day", () => {
    expect(fmtPlainDate("2011-04-17")).toMatch(/17/);
  });

  it("is unaffected by the chosen country", () => {
    resetSettings();
    const auto = fmtPlainDate("2011-04-17");
    for (const c of COUNTRIES) {
      setSetting("country", c.code);
      expect(fmtPlainDate("2011-04-17"), `country ${c.code}`).toBe(auto);
    }
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
