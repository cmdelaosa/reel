/* What the app is entitled to believe about its own connectivity.
 *
 * The offline toast used to be `navigator.onLine`, straight through. That flag
 * does not mean "the internet works" — it means the OS thinks a network
 * interface exists — and it lies in both directions: captive portals and VPNs
 * report online with nothing reachable, and an installed PWA coming back from
 * the background can report offline while every request succeeds. The second
 * one is what shipped: the toast rendered on the flag alone and only re-rendered
 * on the `online`/`offline` events, so a browser that never fired `online` left
 * "changes are paused" on screen forever, over an app that was working fine.
 *
 * So the browser's flag is demoted from verdict to hint. Nothing here reads it;
 * the wiring in lib/connection.ts turns it — along with the tab becoming visible
 * again — into `suspect`, which only means "go and check". The verdict comes
 * from evidence: requests we actually made, and probes we fire ourselves.
 *
 * Two strikes before the toast, and the first one costs nothing: strike 1
 * schedules a probe with a zero delay, so a genuine disconnection is confirmed
 * in the time one failed fetch takes, while a single flaky request never
 * flashes a banner at anyone. Any success at all clears the state, which is the
 * property the old version was missing — there is always a way back.
 */

export type Evidence =
  /** A request or probe completed. Any HTTP status counts: a 500 still proves
   *  we reached the server, which is what the toast is really about. */
  | "reached"
  /** A request or probe failed at the network level (fetch rejected). Aborted
   *  requests are NOT this — see trackedFetch. */
  | "unreachable"
  /** The browser hinted something changed. Never a verdict on its own. */
  | "suspect";

export interface ConnectionState {
  /** Consecutive unconfirmed failures. 0 = believed reachable. */
  strikes: number;
  /** Whether to tell the user. Deliberately lags `strikes` by one. */
  offline: boolean;
}

export const INITIAL: ConnectionState = { strikes: 0, offline: false };

/** Strikes needed before the toast appears. The first failure only earns a
 *  probe; the second — which is that probe having failed too — is the claim. */
const CONFIRM_AT = 2;

export function reduce(state: ConnectionState, evidence: Evidence): ConnectionState {
  switch (evidence) {
    case "reached":
      return INITIAL;
    case "unreachable": {
      const strikes = state.strikes + 1;
      return { strikes, offline: strikes >= CONFIRM_AT };
    }
    case "suspect":
      // Enough to get a probe scheduled, never enough to accuse. A hint while
      // already suspected changes nothing — it must not reset the backoff and
      // spin the probe loop.
      return state.strikes > 0 ? state : { strikes: 1, offline: false };
  }
}

/* Backoff between probes, indexed by strikes. The first is immediate: that
   probe is what turns a suspicion into the toast, and waiting on it would just
   delay the truth. After that it stretches out — a device that has been offline
   for a minute is not about to be fixed by asking four times a second. */
const BACKOFF_MS = [0, 3_000, 5_000, 10_000, 30_000];

/** How long to wait before the next probe, or null when none is due. */
export function probeDelay(state: ConnectionState): number | null {
  if (state.strikes === 0) return null;
  return BACKOFF_MS[Math.min(state.strikes - 1, BACKOFF_MS.length - 1)];
}
