/* Fixed-window rate-limit planner — pure. Given a sequence of request indexes
   and a window budget, decides how long to wait before each request so we
   never exceed `perWindow` requests per `windowMs`. The Deno episode-refresh
   function mirrors this exact logic (no cross-runtime imports). */

export interface LimiterState {
  windowStart: number;
  used: number;
}

export function nextDelay(
  state: LimiterState,
  now: number,
  perWindow: number,
  windowMs: number,
): { delayMs: number; state: LimiterState } {
  // window expired → fresh budget
  if (now - state.windowStart >= windowMs) {
    return { delayMs: 0, state: { windowStart: now, used: 1 } };
  }
  // budget left in the current window
  if (state.used < perWindow) {
    return { delayMs: 0, state: { ...state, used: state.used + 1 } };
  }
  // budget exhausted → wait for the window to roll over
  const delayMs = state.windowStart + windowMs - now;
  return { delayMs, state: { windowStart: state.windowStart + windowMs, used: 1 } };
}
