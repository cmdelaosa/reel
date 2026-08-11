import { describe, expect, it } from "vitest";
import { COUNTRIES, airTimeZone, fmtPlainDate, hasRealAirTime, regionCode } from "@/lib/region";
import { countryFromTimeZone, isCountryCode } from "@/lib/countries";
import { getSettings, resetSettings, setSetting } from "@/lib/settings";

/* The country setting's contract: one explicit country decides both the zone
   air times land in and the region providers are looked up for, and bare TMDB
   dates must stay put regardless of it. */

describe("airTimeZone", () => {
  it("is always a real zone — there is no 'follow my device' any more", () => {
    resetSettings();
    expect(airTimeZone()).toBeTypeOf("string");
    expect(COUNTRIES.map((c) => c.tz)).toContain(airTimeZone());
  });

  it("tracks the chosen country", () => {
    setSetting("country", "ES");
    expect(airTimeZone()).toBe("Europe/Madrid");
    setSetting("country", "DE");
    expect(airTimeZone()).toBe("Europe/Berlin");
    setSetting("country", "CH");
    expect(airTimeZone()).toBe("Europe/Zurich");
    resetSettings();
  });

  it("survives a code we don't carry rather than rendering in no zone", () => {
    setSetting("country", "ZZ");
    expect(COUNTRIES.map((c) => c.tz)).toContain(airTimeZone());
    resetSettings();
  });
});

describe("regionCode", () => {
  it("is the provider lookup key, and follows the same setting", () => {
    setSetting("country", "DE");
    expect(regionCode()).toBe("DE");
    resetSettings();
    // Whatever the device resolved to, it must be a country we actually offer
    // — a bogus code would silently return no providers for every title.
    expect(isCountryCode(regionCode())).toBe(true);
  });
});

describe("the retired 'auto' value", () => {
  // Migrating it is lib/settings' job on load (settings.test.ts). This is the
  // backstop: even handed "auto" directly, region resolves a real country
  // rather than passing it to TMDB or formatting dates in no zone at all.
  it("never reaches TMDB or the date formatters", () => {
    setSetting("country", "auto");
    expect(regionCode()).not.toBe("auto");
    expect(isCountryCode(regionCode())).toBe(true);
    expect(COUNTRIES.map((c) => c.tz)).toContain(airTimeZone());
    resetSettings();
    expect(getSettings().country).not.toBe("auto");
  });
});

describe("countryFromTimeZone", () => {
  it("maps the picker's own zones back to their codes", () => {
    for (const c of COUNTRIES) expect(countryFromTimeZone(c.tz)).toBe(c.code);
  });

  it("knows the zones that are the same country by another name", () => {
    expect(countryFromTimeZone("Atlantic/Canary")).toBe("ES");
    expect(countryFromTimeZone("Europe/Busingen")).toBe("DE");
  });

  it("gives up rather than guessing for anywhere else", () => {
    expect(countryFromTimeZone("America/New_York")).toBeNull();
    expect(countryFromTimeZone(null)).toBeNull();
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
  it("prints a clock for anything but the placeholder", () => {
    expect(hasRealAirTime("tvmaze")).toBe(true);
    // A streamer's release time is derived, not fetched, but it is the real
    // instant the episode appears — it prints like any other (0065).
    expect(hasRealAirTime("platform")).toBe(true);
    expect(hasRealAirTime("estimated")).toBe(false);
    expect(hasRealAirTime(null)).toBe(false);
    expect(hasRealAirTime(undefined)).toBe(false);
  });
});
