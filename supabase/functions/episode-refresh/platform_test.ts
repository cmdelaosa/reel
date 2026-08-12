// Unit tests for the platform lookup. Run by CI's `edge` job (`deno test`).
//
// The rows here are the real ones this change was written for, copied from
// production on 2026-08-12 — including the two that made `network` untenable
// (Futurama filed under FOX and Adults under FX, both streaming on Disney+ in
// Spain) and the junk entry TMDB ships as a provider literally named "The".
import { assertEquals } from "jsr:@std/assert@1";
import { rulePlatform } from "./platform.ts";

const p = (...names: string[]) => names.map((name) => ({ name }));

Deno.test("a show filed under its old broadcaster resolves by what streams it", () => {
  // Futurama: TMDB says FOX, which stopped carrying it in 2013.
  assertEquals(
    rulePlatform({ network: "FOX", providers: { ES: p("Disney+"), US: p("Hulu", "fuboTV", "YouTube TV", "FXNow") } }),
    "Disney+",
  );
  // Adults: TMDB says FX.
  assertEquals(
    rulePlatform({ network: "FX", providers: { ES: p("Disney+"), US: p("Hulu", "fuboTV", "Tubi TV") } }),
    "Disney+",
  );
});

Deno.test("Spain decides when both markets carry a rule", () => {
  assertEquals(
    rulePlatform({ network: null, providers: { ES: p("Netflix"), US: p("Prime Video") } }),
    "Netflix",
  );
});

Deno.test("a streaming network is never overruled by its own reseller", () => {
  // Ted Lasso and Silo, exactly as production holds them: Apple sells itself as
  // a channel inside Prime, so TMDB lists Prime first in both markets. Reading
  // providers before the network moved these two off Apple's release convention
  // (midnight ET, day-shifted) and onto midnight Pacific.
  const appleOriginal = {
    network: "Apple TV",
    providers: { ES: p("Prime Video", "Apple TV+"), US: p("Prime Video", "Apple TV+") },
  };
  assertEquals(rulePlatform(appleOriginal), "Apple TV");
});

Deno.test("a Spanish list opening with an unknown service does not stop the search", () => {
  // Conan: Movistar first in Spain, and neither it nor HBO Max has a rule, so
  // nothing dates this title — but the search must have reached the end to say so.
  assertEquals(
    rulePlatform({ network: "HBO", providers: { ES: p("Movistar Plus+ Ficción Total", "HBO Max"), US: p("HBO Max") } }),
    null,
  );
  // Same shape, but with a service further down the list that we do know.
  assertEquals(
    rulePlatform({ network: "HBO", providers: { ES: p("Movistar Plus+ Ficción Total", "Netflix") } }),
    "Netflix",
  );
});

Deno.test("the network still answers when no provider does — no title loses its clock", () => {
  assertEquals(rulePlatform({ network: "Netflix", providers: {} }), "Netflix");
  assertEquals(rulePlatform({ network: "Netflix", providers: null }), "Netflix");
  assertEquals(rulePlatform({ network: "Netflix" }), "Netflix");
  // And a provider list that knows nothing must not shadow it.
  assertEquals(rulePlatform({ network: "Netflix", providers: { ES: p("Movistar Plus+") } }), "Netflix");
});

Deno.test("platforms we cannot time honestly resolve to nothing", () => {
  // The Paper (SkyShowtime/Peacock), Hot Ones (a US long tail, nothing in Spain).
  assertEquals(rulePlatform({ network: "Peacock", providers: { ES: p("SkyShowtime"), US: p("Peacock Premium") } }), null);
  assertEquals(rulePlatform({ network: "YouTube", providers: { ES: [], US: p("Pluto TV", "Tubi TV") } }), null);
});

Deno.test("countries beyond ES and US are not consulted", () => {
  assertEquals(rulePlatform({ network: "BBC One", providers: { GB: p("Netflix") } }), null);
});

Deno.test("malformed provider entries are stepped over, not tripped on", () => {
  // "The" is real: TMDB's "The Roku Channel" with the reseller suffix stripped.
  assertEquals(
    rulePlatform({ network: null, providers: { US: [{ name: "The" }, { name: null }, {}, { name: "Netflix" }] } }),
    "Netflix",
  );
});
