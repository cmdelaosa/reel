import { assert, assertEquals, assertStringIncludes, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isReadToken, redactCredential, tmdbFetch, tmdbRequest } from "./tmdb.ts";

// A v3 key's real shape (32 hex) and a v4 read token's (a JWT). Neither is real.
const V3 = "0123456789abcdef0123456789abcdef";
const V4 = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwMTIzIn0.c2lnbmF0dXJl";

Deno.test("a v3 key goes in the query, a v4 token in the header", () => {
  const v3 = tmdbRequest(V3, "/tv/1399");
  assertEquals(v3.url, `https://api.themoviedb.org/3/tv/1399?api_key=${V3}`);
  assertEquals(v3.headers, {});

  const v4 = tmdbRequest(V4, "/tv/1399");
  assertEquals(v4.url, "https://api.themoviedb.org/3/tv/1399");
  assertEquals(v4.headers, { Authorization: `Bearer ${V4}` });
  // The point of the whole exercise: with a token there is no credential in the
  // URL for a failed fetch to quote back.
  assert(!v4.url.includes(V4));
});

Deno.test("a path that already has a query keeps its separator right", () => {
  assertEquals(
    tmdbRequest(V3, "/find/1?external_source=tvdb_id").url,
    `https://api.themoviedb.org/3/find/1?external_source=tvdb_id&api_key=${V3}`,
  );
  assertEquals(tmdbRequest(V4, "/find/1?external_source=tvdb_id").url, "https://api.themoviedb.org/3/find/1?external_source=tvdb_id");
});

Deno.test("only a JWT counts as a read token", () => {
  assert(isReadToken(V4));
  assert(!isReadToken(V3));
  assert(!isReadToken("")); // an unset secret must not become `Bearer `
  assert(!isReadToken("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwMTIzIn0")); // two segments, not a JWT
});

Deno.test("redaction blanks the key wherever the URL was quoted", () => {
  const message = `TypeError: error sending request for url (https://api.themoviedb.org/3/tv/1399?api_key=${V3}): client error`;
  const redacted = redactCredential(message);
  assert(!redacted.includes(V3));
  assertStringIncludes(redacted, "api_key=REDACTED");
  assertStringIncludes(redacted, "/tv/1399"); // the useful half survives
  // The value ends at the bracket, not at the next space: eating the `):` would
  // read the failure reason back as part of the URL.
  assertStringIncludes(redacted, "api_key=REDACTED): client error");
});

/** Replace `fetch` for the duration of one test. */
async function withFetch(stub: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("a rejection that quotes the URL leaks neither to the caller nor to the log", async () => {
  // The rejection is built by hand because the runtimes disagree about where
  // they put the URL — this is the shape the Supabase edge runtime raises, with
  // the URL inline, and Deno 2.x's shape (URL only on .cause) is the next test.
  // Both are what the deployed code will meet, and neither may get the key out.
  const stub = ((input: string | URL | Request) =>
    Promise.reject(
      new TypeError(`error sending request for url (${String(input)}): connection reset`),
    )) as typeof fetch;

  const logged: string[] = [];
  await withFetch(stub, async () => {
    const err = await assertRejects(() => tmdbFetch(V3, "/tv/1399", {}, (m) => logged.push(m)));
    assert(!String(err).includes(V3), `the key reached the thrown error: ${err}`);
    assertStringIncludes(String(err), "/tv/1399"); // still says which call failed
    assertStringIncludes(String(err), "TypeError"); // and how it failed
  });

  assertEquals(logged.length, 1);
  assert(!logged[0].includes(V3), `the key reached the log: ${logged[0]}`);
  assertStringIncludes(logged[0], "api_key=REDACTED");
  assertStringIncludes(logged[0], "connection reset"); // the log stays worth reading
});

Deno.test("a rejection that hides the URL on .cause leaks nothing either", async () => {
  const stub = ((input: string | URL | Request) =>
    Promise.reject(
      new TypeError("fetch failed", {
        cause: new TypeError(`error sending request for url (${String(input)}): dns error`),
      }),
    )) as typeof fetch;

  const logged: string[] = [];
  await withFetch(stub, async () => {
    await assertRejects(() => tmdbFetch(V3, "/tv/1399", {}, (m) => logged.push(m)));
  });

  assert(!logged[0].includes(V3), `the key reached the log through .cause: ${logged[0]}`);
  assertStringIncludes(logged[0], "dns error"); // the chain is walked, not just the top
  assertStringIncludes(logged[0], "api_key=REDACTED");
});

Deno.test("with a read token there is no key in the request to leak", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const stub = ((input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      auth: new Headers(init?.headers).get("Authorization"),
    });
    return Promise.reject(new TypeError(`error sending request for url (${String(input)}): dns error`));
  }) as typeof fetch;

  const logged: string[] = [];
  await withFetch(stub, async () => {
    await assertRejects(() => tmdbFetch(V4, "/tv/1399", {}, (m) => logged.push(m)));
  });

  assertEquals(seen[0].auth, `Bearer ${V4}`);
  assert(!seen[0].url.includes(V4));
  // Nothing was redacted here — there was nothing to redact.
  assert(!logged[0].includes(V4), `the token reached the log: ${logged[0]}`);
});

Deno.test("a caller's own headers survive the credential header", async () => {
  const seen: Headers[] = [];
  const stub = ((_input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;

  await withFetch(stub, async () => {
    await tmdbFetch(V4, "/tv/1399", { headers: { Accept: "application/json" } });
    // A Headers instance is the shape an object spread would have thrown away.
    await tmdbFetch(V4, "/tv/1399", { headers: new Headers({ Accept: "application/json" }) });
  });

  for (const headers of seen) {
    assertEquals(headers.get("Accept"), "application/json");
    assertEquals(headers.get("Authorization"), `Bearer ${V4}`);
  }
});
