/* Request coalescing: collapse the lookups made in one tick into a single
   call.

   Deliberately import-free, like lib/countries. Anything that reaches
   lib/supabase throws at *import* time without VITE_SUPABASE_URL in the
   environment (see lib/supabase.ts), which would make this module and its
   tests unloadable in CI — the same trap lib/region documents at its top. The
   fetch is a parameter for that reason and one more: it makes the fiddly part
   below — a queue and a flush that both reset before the fetch resolves —
   testable without mocking the Supabase client, which nothing in this codebase
   does. */

/** Collapse the ids requested in one tick into a single `fetchMany` call.
 *
 *  Callers that ask for an id the fetch returned no entry for get `[]`, not
 *  undefined: for the one caller today those are the same answer (draw no
 *  logo), and a missing row is not an error.
 *
 *  A failed fetch rejects every caller in its batch rather than resolving them
 *  empty — the consumer (TanStack Query) has to see the failure to retry it and
 *  to surface the app's global error toast, instead of caching a confident
 *  wrong answer. The next call opens a fresh batch. */
export function createBatcher<T>(
  fetchMany: (ids: number[]) => Promise<Map<number, T[]>>,
): (id: number) => Promise<T[]> {
  let queued: number[] = [];
  let batch: Promise<Map<number, T[]>> | null = null;

  return (id: number): Promise<T[]> => {
    queued.push(id);
    // setTimeout, not queueMicrotask: the ids arrive as React commits a
    // screen's worth of components, which spans more than one microtask
    // checkpoint. Nothing may await between the push above and the assignment
    // below, or an id could land in a queue whose promise the caller doesn't
    // hold.
    batch ??= new Promise<Map<number, T[]>>((resolve, reject) => {
      setTimeout(() => {
        const ids = [...new Set(queued)];
        queued = [];
        batch = null;
        fetchMany(ids).then(resolve, reject);
      }, 0);
    });
    return batch.then((m) => m.get(id) ?? []);
  };
}
