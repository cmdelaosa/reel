import { describe, expect, it } from "vitest";
import {
  AIR_TIME,
  type AnchoredEpisode,
  type TvmazeEpisode,
  alignedSeasons,
  indexTvmaze,
  resolveAirTime,
  rulePlatform,
} from "@/domain/airPairing";

/* The regression these tests exist for is Hot Ones season 30, reproduced from
   both catalogues as they stood on 2026-08-03: TMDB lists thirteen episodes,
   TVmaze eleven — it carries neither the Tim Howard opener (E1) nor J Balvin
   (E4). Pairing on episode number alone therefore handed our E10 the stamp of
   TVmaze's 30x10, which is our E12: fourteen days out, and it printed the same
   date twice at the end of the season. */

/* A scheduled broadcaster's episode: TVmaze knows the clock, so `airtime` is
   set and the stamp beside it is real. */
const tv = (season: number, number: number, airdate: string, hourUtc = "12:00"): TvmazeEpisode => ({
  season,
  number,
  airdate,
  airtime: hourUtc,
  airstamp: `${airdate}T${hourUtc}:00+00:00`,
});

/* A streamer's episode as TVmaze publishes it: a day, no clock, and a noon-UTC
   stamp that means nothing. */
const web = (season: number, number: number, airdate: string): TvmazeEpisode => ({
  season,
  number,
  airdate,
  airtime: "",
  airstamp: `${airdate}T12:00:00+00:00`,
});

/* TVmaze's season 30, in its own numbering. */
const HOT_ONES_TVMAZE = [
  tv(30, 1, "2026-05-21"), // TMDB's E2 — Colin Jost
  tv(30, 2, "2026-05-28"),
  tv(30, 3, "2026-06-04"),
  tv(30, 4, "2026-06-11"),
  tv(30, 5, "2026-06-18"),
  tv(30, 6, "2026-06-25"),
  tv(30, 7, "2026-07-02"),
  tv(30, 8, "2026-07-09"), // TMDB's E10 — Millie Bobby Brown
  tv(30, 9, "2026-07-16"), // TMDB's E11 — Marcello Hernández
  tv(30, 10, "2026-07-23"), // TMDB's E12 — Tom Holland
  tv(30, 11, "2026-07-30"), // TMDB's E13 — JISOO
];

/* Ours, as TMDB numbers and dates them. */
const OURS = [
  { season_number: 30, episode_number: 1, air_date: "2026-05-18" }, // TVmaze has no such day
  { season_number: 30, episode_number: 2, air_date: "2026-05-21" },
  { season_number: 30, episode_number: 3, air_date: "2026-05-28" },
  { season_number: 30, episode_number: 4, air_date: "2026-06-01" }, // nor this one
  { season_number: 30, episode_number: 10, air_date: "2026-07-09" },
  { season_number: 30, episode_number: 11, air_date: "2026-07-16" },
  { season_number: 30, episode_number: 12, air_date: "2026-07-23" },
  { season_number: 30, episode_number: 13, air_date: "2026-07-30" },
];

describe("resolveAirTime — the Hot Ones regression", () => {
  const idx = indexTvmaze(HOT_ONES_TVMAZE);

  it("never moves an episode off the day TMDB reports", () => {
    for (const ep of OURS) {
      const got = resolveAirTime(ep, idx)!;
      expect(got.air_datetime.slice(0, 10)).toBe(ep.air_date);
    }
  });

  it("re-aligns a shifted catalogue instead of refusing it", () => {
    // The bug: our E10 took 30x10's stamp (Jul 23). The fix finds 30x8, the
    // same episode under TVmaze's numbering, and keeps a real clock.
    expect(resolveAirTime(OURS[4], idx)).toEqual({
      air_datetime: "2026-07-09T12:00:00.000Z",
      air_time_source: "tvmaze",
    });
    expect(resolveAirTime(OURS[5], idx)).toEqual({
      air_datetime: "2026-07-16T12:00:00.000Z",
      air_time_source: "tvmaze",
    });
  });

  it("dates the episodes past the end of TVmaze's numbering", () => {
    // E12 and E13 have no 30x12 / 30x13 to pair with, so the old rule left them
    // on the placeholder. By day they resolve fine.
    expect(resolveAirTime(OURS[6], idx)?.air_time_source).toBe("tvmaze");
    expect(resolveAirTime(OURS[7], idx)?.air_time_source).toBe("tvmaze");
  });

  it("falls back to the placeholder for episodes TVmaze doesn't carry", () => {
    expect(resolveAirTime(OURS[0], idx)).toEqual({
      air_datetime: `2026-05-18${AIR_TIME}`,
      air_time_source: "estimated",
    });
    expect(resolveAirTime(OURS[3], idx)?.air_time_source).toBe("estimated");
  });
});

describe("resolveAirTime", () => {
  it("takes the same-numbered episode when the days agree", () => {
    const idx = indexTvmaze([tv(1, 1, "2011-04-17", "21:00")]);
    expect(resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2011-04-17" }, idx)).toEqual({
      air_datetime: "2011-04-17T21:00:00.000Z",
      air_time_source: "tvmaze",
    });
  });

  it("keeps a stamp that lands on the next UTC day, which is the whole point", () => {
    // Game of Thrones 1x01: 21:00 ET on the 17th is 01:00Z on the 18th. The
    // local `airdate` still reads 2011-04-17, so it pairs — and the instant we
    // store is the real one, a day later in UTC than TMDB's bare date.
    const idx = indexTvmaze([
      { season: 1, number: 1, airdate: "2011-04-17", airtime: "21:00", airstamp: "2011-04-18T01:00:00+00:00" },
    ]);
    expect(resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2011-04-17" }, idx)).toEqual({
      air_datetime: "2011-04-18T01:00:00.000Z",
      air_time_source: "tvmaze",
    });
  });

  it("re-aligns a daily show drifted by one — the case a tolerance would miss", () => {
    // One episode of drift is 7 days on a weekly show and 1 on a daily. A
    // tolerance window would wave the daily through onto the wrong day; matching
    // the day exactly rejects 3x40 and then finds the episode that really aired
    // on the 12th.
    const idx = indexTvmaze([tv(3, 40, "2026-03-11"), tv(3, 41, "2026-03-12")]);
    expect(resolveAirTime({ season_number: 3, episode_number: 40, air_date: "2026-03-12" }, idx)).toEqual({
      air_datetime: "2026-03-12T12:00:00.000Z",
      air_time_source: "tvmaze",
    });
  });

  it("gives no clock when a day carries more than one episode", () => {
    // A whole season dropped at once: by day it's ambiguous, and the numbers
    // already disagree, so there is nothing to pair on.
    const idx = indexTvmaze([tv(2, 1, "2026-06-05"), tv(2, 2, "2026-06-05")]);
    expect(resolveAirTime({ season_number: 2, episode_number: 3, air_date: "2026-06-05" }, idx)).toEqual({
      air_datetime: `2026-06-05${AIR_TIME}`,
      air_time_source: "estimated",
    });
  });

  it("still pairs a same-day drop while the numbering holds", () => {
    const idx = indexTvmaze([tv(2, 1, "2026-06-05", "08:00"), tv(2, 2, "2026-06-05", "08:00")]);
    expect(resolveAirTime({ season_number: 2, episode_number: 2, air_date: "2026-06-05" }, idx)?.air_time_source)
      .toBe("tvmaze");
  });

  it("leaves a row with no TMDB day alone", () => {
    const idx = indexTvmaze([tv(1, 1, "2026-01-01")]);
    expect(resolveAirTime({ season_number: 1, episode_number: 1, air_date: null }, idx)).toBeNull();
    expect(resolveAirTime({ season_number: 1, episode_number: 1 }, idx)).toBeNull();
  });

  it("hands a row back to the placeholder when TVmaze stops accounting for it", () => {
    // The repair path: whatever instant is stored, an episode TVmaze can no
    // longer place gets TMDB's day back rather than keeping an orphaned stamp.
    const idx = indexTvmaze([tv(1, 1, "2026-01-01")]);
    expect(resolveAirTime({ season_number: 1, episode_number: 9, air_date: "2026-02-02" }, idx)).toEqual({
      air_datetime: `2026-02-02${AIR_TIME}`,
      air_time_source: "estimated",
    });
  });
});

/* Silo and Ted Lasso, both from the two catalogues as they stood on 2026-08-11.
   Apple releases at 21:00 Pacific the evening before, so TMDB files the Pacific
   date and TVmaze the day itself — every episode one apart. */
const SILO_TVMAZE = [web(3, 5, "2026-07-31"), web(3, 6, "2026-08-07"), web(3, 7, "2026-08-14")];
const SILO_OURS = [
  { season_number: 3, episode_number: 5, air_date: "2026-07-30" },
  { season_number: 3, episode_number: 6, air_date: "2026-08-06" },
  { season_number: 3, episode_number: 7, air_date: "2026-08-13" },
];

describe("resolveAirTime — streaming (0065)", () => {
  it("does not read a streamer's noon-UTC filler as a clock", () => {
    // TVmaze's `airtime` is empty for everything unscheduled, and the stamp it
    // publishes beside it is invented. Without a platform rule the row gets the
    // placeholder, not 12:00.
    const idx = indexTvmaze([web(5, 1, "2025-12-25")]);
    expect(resolveAirTime({ season_number: 5, episode_number: 1, air_date: "2025-12-25" }, idx)).toEqual({
      air_datetime: `2025-12-25${AIR_TIME}`,
      air_time_source: "estimated",
    });
  });

  it("takes TVmaze's day and the platform's clock for Apple", () => {
    const idx = indexTvmaze(SILO_TVMAZE);
    const realign = alignedSeasons(SILO_OURS, idx);
    expect(realign.has(3)).toBe(true);
    // 00:00 Eastern on the 14th — 06:00 in Madrid, where TMDB's day plus the
    // placeholder used to put it at 23:00 on the 13th.
    expect(resolveAirTime(SILO_OURS[2], idx, { platform: "Apple TV", realign })).toEqual({
      air_datetime: "2026-08-14T04:00:00.000Z",
      air_time_source: "platform",
    });
  });

  it("infers the day from the weekday when TVmaze has nothing", () => {
    // Apple releases on Wednesdays and Fridays. 2026-08-13 is a Thursday, so it
    // is the Pacific evening before the Friday — same answer as above, without
    // TVmaze having said anything.
    expect(resolveAirTime(SILO_OURS[2], indexTvmaze([]), { platform: "Apple TV" })).toEqual({
      air_datetime: "2026-08-14T04:00:00.000Z",
      air_time_source: "platform",
    });
  });

  it("leaves a date that already falls on a release day alone", () => {
    // Ted Lasso season 1, which TMDB filed on the Friday itself.
    expect(
      resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2020-08-14" }, indexTvmaze([]), {
        platform: "Apple TV",
      }),
    ).toEqual({ air_datetime: "2020-08-14T04:00:00.000Z", air_time_source: "platform" });
  });

  it("never shifts a platform that has no release days", () => {
    // Netflix drops the whole season at midnight Pacific on TMDB's own day —
    // and a season dumped at once is exactly the case `paired` refuses, so the
    // platform rule is the only thing that can clock these.
    const idx = indexTvmaze([web(5, 1, "2025-12-25"), web(5, 2, "2025-12-25")]);
    expect(
      resolveAirTime({ season_number: 5, episode_number: 2, air_date: "2025-12-25" }, idx, { platform: "Netflix" }),
    ).toEqual({ air_datetime: "2025-12-25T08:00:00.000Z", air_time_source: "platform" });
  });

  it("resolves the platform's wall clock through its own DST", () => {
    // Same rule, six months apart: Pacific is UTC-8 in December and UTC-7 in
    // July. A fixed offset would put one of the two on the wrong day.
    const summer = resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2026-07-02" }, indexTvmaze([]), {
      platform: "Netflix",
    });
    expect(summer?.air_datetime).toBe("2026-07-02T07:00:00.000Z");
  });

  it("still prefers a broadcaster's real clock to the table", () => {
    // A platform rule is a standing default; an `airtime` is what actually
    // happened. HBO's 21:00 wins even for a title we hold a rule for.
    const idx = indexTvmaze([tv(1, 1, "2026-01-11", "21:00")]);
    expect(
      resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2026-01-11" }, idx, { platform: "Netflix" }),
    ).toEqual({ air_datetime: "2026-01-11T21:00:00.000Z", air_time_source: "tvmaze" });
  });

  it("ignores a platform it holds no rule for", () => {
    expect(
      resolveAirTime({ season_number: 1, episode_number: 1, air_date: "2026-01-11" }, indexTvmaze([]), {
        platform: "Hulu",
      })?.air_time_source,
    ).toBe("estimated");
  });
});

describe("alignedSeasons", () => {
  it("refuses a season TVmaze counts differently — the Hot Ones lock", () => {
    // Thirteen against eleven. Nothing about that season may be re-dated, no
    // matter how close any single pair looks.
    expect(alignedSeasons(OURS, indexTvmaze(HOT_ONES_TVMAZE)).has(30)).toBe(false);
  });

  it("accepts a season TMDB dated inconsistently", () => {
    // Foundation season 1: TMDB filed seven episodes on the Pacific evening and
    // three on the day itself. Mixed offsets are still within a day, so the
    // season re-dates as a whole.
    const theirs = indexTvmaze([web(1, 1, "2021-09-24"), web(1, 2, "2021-10-01"), web(1, 3, "2021-10-08")]);
    const mine: AnchoredEpisode[] = [
      { season_number: 1, episode_number: 1, air_date: "2021-09-23" },
      { season_number: 1, episode_number: 2, air_date: "2021-10-01" },
      { season_number: 1, episode_number: 3, air_date: "2021-10-08" },
    ];
    expect(alignedSeasons(mine, theirs).has(1)).toBe(true);
  });

  it("refuses a season where anything sits more than a day out", () => {
    const theirs = indexTvmaze([web(1, 1, "2026-01-02"), web(1, 2, "2026-01-16")]);
    const mine: AnchoredEpisode[] = [
      { season_number: 1, episode_number: 1, air_date: "2026-01-01" },
      { season_number: 1, episode_number: 2, air_date: "2026-01-08" }, // a week out
    ];
    expect(alignedSeasons(mine, theirs).size).toBe(0);
  });

  it("refuses to move a day backwards", () => {
    // Only ever forward: TMDB filing a date LATER than TVmaze is not the
    // Pacific-evening pattern, it's a disagreement we have no rule for.
    const theirs = indexTvmaze([web(1, 1, "2026-01-01")]);
    expect(alignedSeasons([{ season_number: 1, episode_number: 1, air_date: "2026-01-02" }], theirs).size).toBe(0);
  });

  it("skips specials and rows with no anchor", () => {
    const theirs = indexTvmaze([web(1, 1, "2026-01-02")]);
    const mine: AnchoredEpisode[] = [
      { season_number: 0, episode_number: 1, air_date: "2026-01-01" },
      { season_number: 1, episode_number: 1, air_date: "2026-01-01" },
      { season_number: 1, episode_number: 2, air_date: null },
    ];
    expect(alignedSeasons(mine, theirs).has(1)).toBe(true);
  });
});

describe("indexTvmaze", () => {
  it("skips specials and undated entries", () => {
    const idx = indexTvmaze([
      tv(0, 1, "2026-01-01"),
      { season: 1, number: 2, airdate: "2026-01-08", airstamp: null },
      { season: null, number: 3, airdate: "2026-01-15", airstamp: "2026-01-15T12:00:00+00:00" },
      tv(1, 4, "2026-01-22"),
    ]);
    expect(idx.size).toBe(1);
    expect([...idx.byDate.keys()]).toEqual(["2026-01-22"]);
  });

  it("survives an empty or missing payload", () => {
    expect(indexTvmaze([]).size).toBe(0);
    expect(indexTvmaze(null).size).toBe(0);
    expect(indexTvmaze(undefined).size).toBe(0);
  });
});

/* Which platform's rule dates a title. The rows are the real ones this lookup
   was written for, copied from production on 2026-08-12 — the two that made
   `network` untenable (Futurama filed under FOX and Adults under FX, both
   streaming on Disney+ in Spain), the two that pin the order (Apple originals
   that Spain lists under Prime), and the junk entry TMDB ships as a provider
   named literally "The" — that is "The Roku Channel" with the reseller suffix
   stripped. */
describe("rulePlatform", () => {
  const p = (...names: string[]) => names.map((name) => ({ name }));

  it("dates a show by what streams it, not by the broadcaster it left", () => {
    expect(rulePlatform({
      network: "FOX", // Futurama, which FOX stopped carrying in 2013
      providers: { ES: p("Disney+"), US: p("Hulu", "fuboTV", "YouTube TV", "FXNow") },
    })).toBe("Disney+");
    expect(rulePlatform({
      network: "FX", // Adults
      providers: { ES: p("Disney+"), US: p("Hulu", "fuboTV", "Tubi TV") },
    })).toBe("Disney+");
  });

  it("never lets a reseller overrule the streaming network itself", () => {
    // Ted Lasso and Silo: Apple sells itself as a channel inside Prime, so TMDB
    // lists Prime first in both markets. Reading providers before the network
    // moved these two off Apple's convention (midnight ET, day-shifted) and
    // onto midnight Pacific.
    expect(rulePlatform({
      network: "Apple TV",
      providers: { ES: p("Prime Video", "Apple TV+"), US: p("Prime Video", "Apple TV+") },
    })).toBe("Apple TV");
  });

  it("prefers Spain when both markets carry a rule", () => {
    expect(rulePlatform({ network: null, providers: { ES: p("Netflix"), US: p("Prime Video") } }))
      .toBe("Netflix");
  });

  it("keeps looking past a service it has no rule for", () => {
    // A Spanish list usually opens with Movistar; the next entry must still count.
    expect(rulePlatform({ network: "HBO", providers: { ES: p("Movistar Plus+ Ficción Total", "Netflix") } }))
      .toBe("Netflix");
  });

  it("leaves no title worse off than the network alone left it", () => {
    expect(rulePlatform({ network: "Netflix", providers: {} })).toBe("Netflix");
    expect(rulePlatform({ network: "Netflix", providers: null })).toBe("Netflix");
    expect(rulePlatform({ network: "Netflix" })).toBe("Netflix");
    // An unknown provider list must not shadow a network that does have a rule.
    expect(rulePlatform({ network: "Netflix", providers: { ES: p("Movistar Plus+") } })).toBe("Netflix");
  });

  it("answers nothing for the platforms we cannot time honestly", () => {
    // Conan (HBO Max), The Paper (SkyShowtime/Peacock), Hot Ones (a US long tail).
    expect(rulePlatform({ network: "HBO", providers: { ES: p("Movistar Plus+ Ficción Total", "HBO Max") } })).toBeNull();
    expect(rulePlatform({ network: "Peacock", providers: { ES: p("SkyShowtime"), US: p("Peacock Premium") } })).toBeNull();
    expect(rulePlatform({ network: "YouTube", providers: { ES: [], US: p("Pluto TV", "Tubi TV") } })).toBeNull();
  });

  it("consults no country beyond ES and US", () => {
    expect(rulePlatform({ network: "BBC One", providers: { GB: p("Netflix") } })).toBeNull();
  });

  it("steps over malformed provider entries", () => {
    expect(rulePlatform({
      network: null,
      providers: { US: [{ name: "The" }, { name: null }, {}, { name: "Netflix" }] },
    })).toBe("Netflix");
  });
});
