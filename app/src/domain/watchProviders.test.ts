import { describe, expect, it } from "vitest";
import { canonicalProvider, providerMap } from "@/domain/watchProviders";

/* Distinct artwork per provider by default, as TMDB really returns it — the
   shared-icon case (a package and its add-on) is exercised explicitly by
   passing the same path to both. */
const p = (provider_id: number, provider_name: string, logo_path: string | null = `/${provider_id}.jpg`) =>
  ({ provider_id, provider_name, logo_path });

describe("canonicalProvider", () => {
  it("folds the ad-supported tiers into the parent brand", () => {
    expect(canonicalProvider("Netflix basic with Ads")).toBe("Netflix");
    expect(canonicalProvider("Netflix Standard with Ads")).toBe("Netflix");
    // No tier word at all — how TMDB really spells Prime Video's ad tier, and
    // the reason Spain returns Prime Video twice for Monk and Mr. Bean.
    expect(canonicalProvider("Amazon Prime Video with Ads")).toBe("Prime Video");
  });

  it("maps TMDB's renamed Apple service onto the name we ship art for", () => {
    // Only subscription buckets are read, so "Apple TV" is always the service
    // — the rent/buy storefront comes through as "Apple TV Store".
    expect(canonicalProvider("Apple TV")).toBe("Apple TV+");
  });

  it("uses the network spelling, since one component draws both", () => {
    expect(canonicalProvider("Amazon Prime Video")).toBe("Prime Video");
    expect(canonicalProvider("Disney Plus")).toBe("Disney+");
    expect(canonicalProvider("Apple TV Plus")).toBe("Apple TV+");
  });

  it("folds a service resold through another storefront into itself", () => {
    expect(canonicalProvider("HBO Max Amazon Channel")).toBe("HBO Max");
    expect(canonicalProvider("Paramount+ Apple TV Channel")).toBe("Paramount+");
    expect(canonicalProvider("AMC+ Roku Channel")).toBe("AMC+");
  });

  it("trims the trailing spaces TMDB really ships", () => {
    // Exactly as the API returns it for House of the Dragon in Spain.
    expect(canonicalProvider("Movistar Plus+ Ficción Total ")).toBe("Movistar Plus+ Ficción Total");
  });

  it("leaves a sub-package as its own service, not merged into the parent", () => {
    // You can pay for Movistar Plus+ and still not have Ficción Total; saying
    // otherwise would promise a show you can't actually watch.
    expect(canonicalProvider("Movistar Plus+ Ficción Total")).not.toBe("Movistar Plus+");
  });

  it("leaves anything else exactly as TMDB spells it", () => {
    expect(canonicalProvider("Movistar Plus+")).toBe("Movistar Plus+");
    expect(canonicalProvider("SkyShowtime")).toBe("SkyShowtime");
    expect(canonicalProvider("Filmin")).toBe("Filmin");
    expect(canonicalProvider("Pluto TV")).toBe("Pluto TV");
  });

  it("only strips the suffix at the end, never mid-name", () => {
    // The tier and reseller suffixes are anchored, so a brand that merely
    // contains the words keeps them.
    expect(canonicalProvider("With Ads Network")).toBe("With Ads Network");
    expect(canonicalProvider("Amazon Channel Films")).toBe("Amazon Channel Films");
  });
});

describe("providerMap", () => {
  it("keeps every country in one column, so a change of country needs no refetch", () => {
    const out = providerMap({
      ES: { flatrate: [p(8, "Netflix")] },
      DE: { flatrate: [p(30, "WOW")] },
    });
    expect(Object.keys(out).sort()).toEqual(["DE", "ES"]);
    expect(out.ES).toEqual([{ name: "Netflix", logo_path: "/8.jpg" }]);
  });

  it("drops rent and buy — they'd put Apple TV on half the library", () => {
    const out = providerMap({
      ES: {
        flatrate: [p(8, "Netflix")],
        // @ts-expect-error rent/buy are deliberately absent from the type
        rent: [p(2, "Apple TV")],
        buy: [p(3, "Google Play Movies")],
      },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Netflix"]);
  });

  it("stores nothing for a country where the only access is rent", () => {
    const out = providerMap({
      // @ts-expect-error same
      ES: { rent: [p(2, "Apple TV")] },
    });
    expect(out.ES).toBeUndefined();
    expect(out).toEqual({});
  });

  it("keeps the real House of the Dragon payload down to two logos in Spain", () => {
    // Verbatim from the API: the reseller duplicate would otherwise take the
    // third slot on the poster with a second HBO Max.
    const out = providerMap({
      ES: {
        flatrate: [
          p(2241, "Movistar Plus+ Ficción Total "),
          p(1899, "HBO Max"),
          p(1825, "HBO Max Amazon Channel"),
        ],
      },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Movistar Plus+ Ficción Total", "HBO Max"]);
  });

  it("counts a brand once even when its tiers span two buckets", () => {
    const out = providerMap({
      ES: { flatrate: [p(8, "Netflix")], ads: [p(1796, "Netflix Standard with Ads")] },
    });
    expect(out.ES).toHaveLength(1);
    expect(out.ES[0].name).toBe("Netflix");
  });

  it("shows Prime Video once for Monk, as the real Spanish payload returns it", () => {
    const out = providerMap({
      ES: { flatrate: [p(119, "Amazon Prime Video"), p(2100, "Amazon Prime Video with Ads")] },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Prime Video"]);
  });

  it("keeps TMDB's order, and a brand's best position when it repeats", () => {
    const out = providerMap({
      ES: {
        flatrate: [p(8, "Netflix"), p(149, "Movistar Plus+")],
        free: [p(8, "Netflix"), p(63, "Filmin")],
      },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Netflix", "Movistar Plus+", "Filmin"]);
  });

  it("shows one Movistar tile when the base package and its add-on both carry a show", () => {
    // Real Spanish payload: same brand, near-identical icons, different files.
    const out = providerMap({
      ES: {
        flatrate: [
          p(149, "Movistar Plus+", "/jse4MOi92Jgetym7nbXFZZBI6LK.jpg"),
          p(2241, "Movistar Plus+ Ficción Total ", "/f6TRLB3H4jDpFEZ0z2KWSSvu1SB.jpg"),
          p(1899, "HBO Max", "/hbomax.jpg"),
        ],
      },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Movistar Plus+", "HBO Max"]);
  });

  it("keeps the parent even when TMDB lists the add-on first", () => {
    const out = providerMap({
      ES: {
        flatrate: [p(2241, "Movistar Plus+ Ficción Total"), p(149, "Movistar Plus+")],
      },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Movistar Plus+"]);
  });

  it("folds a shared icon under two names too", () => {
    const out = providerMap({
      ES: { flatrate: [p(1, "Some Service", "/same.jpg"), p(2, "Other Name", "/same.jpg")] },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Some Service"]);
  });

  it("leaves two brands alone when neither extends the other", () => {
    const out = providerMap({
      ES: { flatrate: [p(1, "Movistar Plus+"), p(2, "Movistar TV")] },
    });
    expect(out.ES).toHaveLength(2);
  });

  it("still names the add-on when it's the only one carrying the show", () => {
    const out = providerMap({
      ES: { flatrate: [p(2241, "Movistar Plus+ Ficción Total ", "/movistar.jpg")] },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Movistar Plus+ Ficción Total"]);
  });

  it("doesn't collapse distinct providers that both lack artwork", () => {
    const out = providerMap({
      ES: { flatrate: [p(1, "Filmin", null), p(2, "Tivify", null)] },
    });
    expect(out.ES.map((x) => x.name)).toEqual(["Filmin", "Tivify"]);
  });

  it("carries a missing logo through as null rather than dropping the provider", () => {
    const out = providerMap({ ES: { flatrate: [p(8, "Netflix", null)] } });
    expect(out.ES[0]).toEqual({ name: "Netflix", logo_path: null });
  });

  it("is empty, not thrown, for a payload with no providers at all", () => {
    expect(providerMap(undefined)).toEqual({});
    expect(providerMap(null)).toEqual({});
    expect(providerMap({})).toEqual({});
  });
});
