import { beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES, isCountryCode } from "@/lib/countries";

/* The country migration runs once, during module init — so each case has to
   plant its localStorage and then import lib/settings fresh. */

const KEY = "reel.settings";
const stored = () => JSON.parse(localStorage.getItem(KEY) as string);

async function bootWith(raw: unknown) {
  localStorage.clear();
  vi.resetModules();
  if (raw !== undefined) localStorage.setItem(KEY, JSON.stringify(raw));
  return await import("@/lib/settings");
}

describe("country on load", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("replaces the retired 'auto' with a country we actually offer", async () => {
    const { getSettings } = await bootWith({ theme: "oled", country: "auto" });
    expect(getSettings().country).not.toBe("auto");
    expect(isCountryCode(getSettings().country)).toBe(true);
  });

  it("writes the resolved country back, so it stops being a guess", async () => {
    const { getSettings } = await bootWith({ country: "auto" });
    expect(stored().country).toBe(getSettings().country);
  });

  it("leaves a country the viewer chose alone", async () => {
    const { getSettings } = await bootWith({ country: "DE" });
    expect(getSettings().country).toBe("DE");
  });

  it("doesn't rewrite storage when nothing needed migrating", async () => {
    const { getSettings } = await bootWith({ country: "CH", accent: "violet" });
    expect(getSettings().country).toBe("CH");
    expect(stored().accent).toBe("violet");
  });

  it("resolves a country for a first-run viewer with no storage at all", async () => {
    const { getSettings } = await bootWith(undefined);
    expect(isCountryCode(getSettings().country)).toBe(true);
  });

  it("survives a retired or hand-edited code", async () => {
    const { getSettings } = await bootWith({ country: "ZZ" });
    expect(isCountryCode(getSettings().country)).toBe(true);
  });

  it("keeps the other settings it found", async () => {
    const { getSettings } = await bootWith({ country: "auto", theme: "light", language: "es" });
    expect(getSettings().theme).toBe("light");
    expect(getSettings().language).toBe("es");
  });

  it("falls back to defaults on corrupt storage", async () => {
    localStorage.clear();
    vi.resetModules();
    localStorage.setItem(KEY, "{not json");
    const { getSettings } = await import("@/lib/settings");
    expect(COUNTRIES.map((c) => c.code)).toContain(getSettings().country);
  });
});

/* `services` sale de localStorage y entra en una URL que se le manda a TMDB
   (with_watch_providers). Es la misma frontera que el país, así que se sanea
   igual: lo que no sea una lista de enteros no pasa. */
describe("services on load", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("starts empty, which means 'everything in my country'", async () => {
    const { getSettings } = await bootWith({ country: "ES" });
    expect(getSettings().services).toEqual([]);
  });

  it("keeps the ids the viewer picked", async () => {
    const { getSettings } = await bootWith({ country: "ES", services: [8, 337] });
    expect(getSettings().services).toEqual([8, 337]);
  });

  it("drops the whole list when storage holds something that isn't one", async () => {
    const { getSettings } = await bootWith({ country: "ES", services: "8,337" });
    expect(getSettings().services).toEqual([]);
  });

  it("drops a list with a non-integer rather than passing it to TMDB", async () => {
    const { getSettings } = await bootWith({ country: "ES", services: [8, "337); drop"] });
    expect(getSettings().services).toEqual([]);
  });
});
