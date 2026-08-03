import { describe, expect, it } from "vitest";
import { INITIAL, probeDelay, reduce, type ConnectionState } from "@/domain/connection";

const feed = (evidence: Parameters<typeof reduce>[1][], from: ConnectionState = INITIAL) =>
  evidence.reduce(reduce, from);

describe("reduce", () => {
  it("says nothing on a single failure", () => {
    // One flaky request must not flash a banner; it only earns a probe.
    expect(feed(["unreachable"])).toEqual({ strikes: 1, offline: false });
  });

  it("accuses once the failure is confirmed", () => {
    expect(feed(["unreachable", "unreachable"]).offline).toBe(true);
  });

  it("clears on any success, however deep the hole", () => {
    const stuck = feed(["unreachable", "unreachable", "unreachable", "unreachable"]);
    expect(stuck.offline).toBe(true);
    expect(reduce(stuck, "reached")).toEqual(INITIAL);
  });

  it("treats a browser hint as a reason to check, not a verdict", () => {
    // This is the whole fix: navigator.onLine going false can no longer put the
    // toast on screen by itself.
    expect(feed(["suspect"])).toEqual({ strikes: 1, offline: false });
    expect(feed(["suspect", "suspect", "suspect"]).offline).toBe(false);
  });

  it("lets a hint escalate only through a real failed probe", () => {
    expect(feed(["suspect", "unreachable"]).offline).toBe(true);
  });

  it("does not let repeated hints reset the backoff", () => {
    // A tab flipping visible/hidden must not spin the probe loop back to 0ms.
    const deep = feed(["unreachable", "unreachable", "unreachable"]);
    expect(reduce(deep, "suspect")).toEqual(deep);
  });
});

describe("probeDelay", () => {
  it("schedules nothing while everything is fine", () => {
    expect(probeDelay(INITIAL)).toBeNull();
  });

  it("probes immediately on first suspicion", () => {
    // The confirming probe is what raises the toast — delaying it delays truth.
    expect(probeDelay({ strikes: 1, offline: false })).toBe(0);
  });

  it("backs off as failures pile up, and caps", () => {
    const delays = [1, 2, 3, 4, 5, 6, 20].map((strikes) => probeDelay({ strikes, offline: true }));
    expect(delays).toEqual([0, 3_000, 5_000, 10_000, 30_000, 30_000, 30_000]);
  });

  it("always leaves a way back — a probe stays scheduled forever", () => {
    // The old toast had no recovery path at all if `online` never fired.
    expect(probeDelay({ strikes: 999, offline: true })).not.toBeNull();
  });
});
