import { describe, expect, it } from "vitest";
import { nextDelay, type LimiterState } from "@/domain/rateLimit";

const LIMIT = 40;
const WINDOW = 10_000;

describe("nextDelay (40 req / 10s fixed window)", () => {
  it("first 40 requests in a window run immediately", () => {
    let state: LimiterState = { windowStart: 0, used: 0 };
    for (let i = 0; i < LIMIT; i++) {
      const r = nextDelay(state, 100 * i, LIMIT, WINDOW);
      expect(r.delayMs).toBe(0);
      state = r.state;
    }
    expect(state.used).toBe(LIMIT);
  });

  it("request 41 inside the window waits for the rollover", () => {
    const state: LimiterState = { windowStart: 0, used: LIMIT };
    const r = nextDelay(state, 4_000, LIMIT, WINDOW);
    expect(r.delayMs).toBe(6_000); // until t=10s
    expect(r.state).toEqual({ windowStart: WINDOW, used: 1 });
  });

  it("a request after the window expired resets the budget", () => {
    const state: LimiterState = { windowStart: 0, used: LIMIT };
    const r = nextDelay(state, 12_500, LIMIT, WINDOW);
    expect(r.delayMs).toBe(0);
    expect(r.state).toEqual({ windowStart: 12_500, used: 1 });
  });

  it("sustained load: 120 requests take ≥ 2 full windows of waiting", () => {
    let state: LimiterState = { windowStart: 0, used: 0 };
    let clock = 0;
    let totalWait = 0;
    for (let i = 0; i < 120; i++) {
      const r = nextDelay(state, clock, LIMIT, WINDOW);
      totalWait += r.delayMs;
      clock += r.delayMs; // requests themselves are instant in this model
      state = r.state;
    }
    expect(totalWait).toBe(2 * WINDOW);
  });
});
