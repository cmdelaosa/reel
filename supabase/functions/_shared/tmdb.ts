// The one place a TMDB credential is allowed to touch a request.
//
// Everything that talks to TMDB in this repo — tmdb-proxy, the episode-refresh
// cron, the TV Time importer core (Node CLI *and* edge function) and the
// network-logo backfill — goes through `tmdbFetch`. There used to be four
// hand-written copies of the same line:
//
//     fetch(`${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${key}`)
//
// and that line has a failure mode that is invisible until it bites. When
// `fetch` itself fails — DNS, connection reset, the timeout signal — Deno (and
// Node) build the TypeError message out of the WHOLE request URL, query string
// included. What happens to that message is then up to the caller: tmdb-proxy
// serialised it into the 502 body, so the key reached the browser's network
// tab; episode-refresh pushed it into `job_runs.summary.sample`, where it sat
// in the database with no expiry; the importer wrote it to
// `import_jobs.report.error`, which the client renders on screen. A momentary
// network blip was enough to publish the project's TMDB key three ways.
//
// Two defences here, and the second matters even with the first in place:
//
//  1. Transport. Given a v4 *read access token* the credential rides in an
//     Authorization header and never enters a URL at all — nothing to leak.
//     TMDB_API_KEY holds either form (see below), so this is a secret swap,
//     not a deploy.
//  2. Sanitising. A v3 key has no header form — TMDB only accepts it as
//     `?api_key=` — so for as long as the deployed secret is a v3 key the URL
//     does carry it, and the network error still has to be defused. Callers
//     get an error naming the path and the cause, never the URL.
//
// Mirrors igdb-proxy's `fetchToken`, which keeps the Twitch client secret in a
// form body for exactly this reason.

/** TMDB's v3 base. Both credential forms are served from it: the v4 token is
 *  an authentication scheme, not a different API. */
export const TMDB = "https://api.themoviedb.org/3";

/** A v4 read access token, i.e. a JWT: three dot-separated segments starting
 *  with the `{"alg"…` that base64url-encodes to `ey`. A v3 key is 32 hex
 *  characters and can never match, so one secret can hold either and the shape
 *  decides how it travels. Anything unrecognisable is treated as a v3 key —
 *  the behaviour this repo had before, so a malformed secret fails the way it
 *  always did instead of failing a new way. */
const READ_TOKEN = /^ey[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const isReadToken = (credential: string) => READ_TOKEN.test(credential);

/** The URL and headers for one TMDB call — split out from `tmdbFetch` so it
 *  can be asserted on without a network. */
export function tmdbRequest(credential: string, path: string): { url: string; headers: Record<string, string> } {
  if (isReadToken(credential)) {
    return { url: `${TMDB}${path}`, headers: { Authorization: `Bearer ${credential}` } };
  }
  return {
    url: `${TMDB}${path}${path.includes("?") ? "&" : "?"}api_key=${credential}`,
    headers: {},
  };
}

/** Blank the `api_key` in any text before it is logged.
 *
 *  The redacted text is still worth logging: whoever is debugging needs to see
 *  that it was a connection reset on `/tv/1399` and not a 404. What they do
 *  not need is the key, and a log line outlives the incident.
 *
 *  The closing bracket characters are excluded because that is where the value
 *  actually ends in the text this meets — `…?api_key=abc): dns error` is the
 *  runtime's own shape, and swallowing the `):` glues the reason onto the URL
 *  and costs the line the readability that is the point of logging it. */
export const redactCredential = (text: string) => text.replace(/api_key=[^&\s"'\])]*/g, "api_key=REDACTED");

/** Why a `fetch` rejected, in a form safe to pass on.
 *
 *  Only the error's *name* is reused, never its message: `TypeError` and
 *  `TimeoutError` (what `AbortSignal.timeout` raises) tell apart "TMDB is
 *  unreachable" from "TMDB is slow", which is most of the diagnostic value of
 *  the message, and a name cannot carry a URL. */
const cause = (err: unknown) => (err instanceof Error && err.name ? err.name : "network error");

/** The whole cause chain, flattened, for the log.
 *
 *  Walked by hand rather than taken from `String(err)` because the runtimes put
 *  the interesting part in different places, and both are moving targets: Deno
 *  2.x rejects a DNS failure with a bare "TypeError: fetch failed" and hangs
 *  the real text ("error sending request for url (…): dns error") off `.cause`,
 *  while older builds — and the edge runtime this deploys to — inline it in the
 *  message. Reading only one of the two is how a log ends up saying "fetch
 *  failed" and nothing else, or how a redaction misses the copy it did not
 *  think to look at. The result goes through redactCredential regardless. */
const detail = (err: unknown): string => {
  const chain: string[] = [];
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; depth++) {
    chain.push(`${e.name}: ${e.message}`);
    e = (e as { cause?: unknown }).cause;
  }
  return chain.length ? chain.join(" ← ") : String(err);
};

/** A TMDB call with the credential kept out of every error it can produce.
 *
 *  Returns the raw `Response`: whether a non-2xx is fatal, retried or cached is
 *  each caller's policy, and TMDB's own status and body carry no secret, so
 *  they stay useful and stay theirs to report. Only the *rejection* — the case
 *  where there is no response and the message is built from the request — is
 *  rewritten here.
 *
 *  `log` exists because the runtimes disagree about what a console is: the edge
 *  functions pass `console.error`, the Node CLI leaves it out and prints the
 *  throw itself. */
export async function tmdbFetch(
  credential: string,
  path: string,
  init: RequestInit = {},
  log?: (message: string) => void,
): Promise<Response> {
  const { url, headers } = tmdbRequest(credential, path);
  // Through Headers rather than an object spread, which silently drops a
  // caller's headers when they arrive as a Headers instance or an entry array.
  const merged = new Headers(init.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  try {
    return await fetch(url, { ...init, headers: merged });
  } catch (err) {
    log?.(`TMDB ${path} failed: ${redactCredential(detail(err))}`);
    throw new Error(`TMDB ${path}: ${cause(err)}`);
  }
}
