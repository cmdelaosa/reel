import { describe, expect, it } from "vitest";
import {
  AIR_TIME,
  type TvmazeEpisode,
  indexTvmaze,
  resolveAirTime,
} from "@/domain/airPairing";

/* The regression these tests exist for is Hot Ones season 30, reproduced from
   both catalogues as they stood on 2026-08-03: TMDB lists thirteen episodes,
   TVmaze eleven — it carries neither the Tim Howard opener (E1) nor J Balvin
   (E4). Pairing on episode number alone therefore handed our E10 the stamp of
   TVmaze's 30x10, which is our E12: fourteen days out, and it printed the same
   date twice at the end of the season. */

const tv = (season: number, number: number, airdate: string, hourUtc = "12:00"): TvmazeEpisode => ({
  season,
  number,
  airdate,
  airstamp: `${airdate}T${hourUtc}:00+00:00`,
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
    const idx = indexTvmaze([{ season: 1, number: 1, airdate: "2011-04-17", airstamp: "2011-04-18T01:00:00+00:00" }]);
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
