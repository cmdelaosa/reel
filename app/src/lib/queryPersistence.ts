import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

const DB_NAME = "reel-query-cache";
const STORE_NAME = "cache";
const SNAPSHOT_KEY = "metadata-v1";
const BUSTER = "metadata-v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

interface Snapshot {
  buster: string;
  savedAt: number;
  state: DehydratedState;
}

/** Only public-ish TMDB metadata is durable. User history, ratings, auth and
 * Maps deliberately remain memory-only and are cleared normally on sign-out. */
export function isPersistableMetadataKey(key: QueryKey): boolean {
  return key[0] === "title" || key[0] === "season";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSnapshot(): Promise<Snapshot | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function restoreMetadataCache(client: QueryClient): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const snapshot = await readSnapshot();
    if (!snapshot || snapshot.buster !== BUSTER || Date.now() - snapshot.savedAt > MAX_AGE_MS) return;
    hydrate(client, snapshot.state);
  } catch {
    // Private browsing/storage denial must never prevent the app from booting.
  }
}

export function watchMetadataCache(client: QueryClient): () => void {
  if (typeof indexedDB === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let queued = false;

  const persist = async () => {
    if (writing) {
      queued = true;
      return;
    }
    writing = true;
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" && isPersistableMetadataKey(query.queryKey),
      });
      await writeSnapshot({ buster: BUSTER, savedAt: Date.now(), state });
    } catch {
      // Persistence is an enhancement; the in-memory QueryClient remains valid.
    } finally {
      writing = false;
      if (queued) {
        queued = false;
        void persist();
      }
    }
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event?.query && !isPersistableMetadataKey(event.query.queryKey)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void persist(), 250);
  });

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
