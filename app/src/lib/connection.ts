import { INITIAL, probeDelay, reduce, type ConnectionState, type Evidence } from "@/domain/connection";

/* Wiring for the connectivity belief in domain/connection.ts: where the
   evidence comes from, and who goes looking for more.

   Evidence arrives two ways. Every request the app already makes is routed
   through trackedFetch — the Supabase client's `global.fetch` and the
   tmdb-proxy client — so ordinary traffic keeps the state honest for free.
   When that traffic dries up, or the browser hints that something changed, we
   fire our own probe rather than guessing.

   The probe is a same-origin asset, not a Supabase endpoint: no CORS to get
   wrong, no key, and it is already in the browser's reach. Real requests
   remain the sharper signal — they hit the actual backend — so the probe only
   ever runs when we are already suspicious. */

const PROBE_PATH = "/favicon.svg";

let state: ConnectionState = INITIAL;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let probeCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function apply(evidence: Evidence) {
  const next = reduce(state, evidence);
  const changed = next.offline !== state.offline;
  const rescheduled = next.strikes !== state.strikes;
  state = next;
  if (changed) emit();
  if (rescheduled) schedule();
}

function schedule() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const delay = probeDelay(state);
  if (delay === null) return;
  timer = setTimeout(() => {
    timer = null;
    void probe();
  }, delay);
}

async function probe() {
  // One at a time: a hint arriving mid-probe would otherwise stack requests on
  // a connection we already suspect of being dead.
  if (inFlight) return;
  inFlight = true;
  try {
    // Cache-busted and no-store, or a cached 200 would "prove" a network that
    // isn't there. HEAD keeps it to headers.
    await fetch(`${PROBE_PATH}?ping=${++probeCount}`, { method: "HEAD", cache: "no-store" });
    apply("reached");
  } catch {
    apply("unreachable");
  } finally {
    inFlight = false;
  }
}

/** fetch, with the outcome reported as evidence. Drop-in: it neither changes
 *  the response nor swallows the error.
 *
 *  An aborted request is not evidence of anything — TanStack Query cancels
 *  in-flight queries on unmount and on refetch, and counting those as network
 *  failures would put the toast up during ordinary navigation. */
export const trackedFetch: typeof fetch = async (input, init) => {
  try {
    const res = await fetch(input, init);
    apply("reached");
    return res;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    apply("unreachable");
    throw err;
  }
};

/* Browser hints. None of these decides anything — each just asks for a probe.
   `visibilitychange` is the one that matters most in practice: an installed PWA
   resuming from the background is exactly where navigator.onLine goes stale and
   where no `online` event is coming to rescue it. */
if (typeof window !== "undefined") {
  const suspect = () => apply("suspect");
  window.addEventListener("offline", suspect);
  window.addEventListener("online", suspect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") suspect();
  });
}

export function subscribeConnection(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const isOffline = () => state.offline;
