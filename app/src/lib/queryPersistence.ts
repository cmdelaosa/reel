import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { z } from "zod";
import { libraryRowSchema } from "@/lib/schemas";
import { upNextRowSchema } from "@/lib/upnext";

const DB_NAME = "reel-query-cache";
const STORE_NAME = "cache";
const SNAPSHOT_KEY = "metadata-v1";
// Bump to drop every client's persisted snapshot on next load (fresh poster/
// still paths et al). v2: 2026-07-18 photo-cache refresh.
const BUSTER = "metadata-v2";
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

interface Snapshot {
  buster: string;
  savedAt: number;
  state: DehydratedState;
}

/** Only public-ish TMDB metadata goes in the SHARED snapshot. User history,
 * ratings, auth and Maps deliberately remain memory-only and are cleared
 * normally on sign-out. What belongs to one account goes in the other
 * snapshot, below — the one stamped with the user id. */
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

async function readRecord<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeRecord(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function deleteRecord(key: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
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
    const snapshot = await readRecord<Snapshot>(SNAPSHOT_KEY);
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
        shouldDehydrateMutation: () => false,
      });
      await writeRecord(SNAPSHOT_KEY, { buster: BUSTER, savedAt: Date.now(), state });
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

/* ── la instantánea DE LA CUENTA ──────────────────────────────────────────────
 *
 * EL PROBLEMA. La biblioteca no pinta una carátula hasta que `rpc_library_rollup`
 * contesta, y con 2.109 filas eso son unos cinco segundos. La caché de consultas
 * lo tapa dentro de una sesión (1248 ms en frío contra 188 ms en caliente), pero
 * es SOLO MEMORIA: cada pestaña nueva vuelve a pagarlo entero.
 *
 * Arriba ya había disco, y la biblioteca no estaba dentro por un buen motivo:
 * esa instantánea es una sola, compartida por todo el que use el aparato, y ahí
 * solo puede ir lo que no es de nadie —fichas de TMDB—. Una biblioteca es de una
 * cuenta. (De paso, eso explica por qué se midió VACÍA: `title`/`season` solo se
 * piden al abrir una ficha, así que quien entra y mira su biblioteca no escribe
 * nada en ella.)
 *
 * LA SALIDA. Una SEGUNDA instantánea, con el id de la cuenta escrito dentro y
 * cuatro cierres:
 *
 *   1. POR CUENTA. Se guarda `userId` y solo se hidrata si coincide con quien
 *      está entrando — la misma idea que `reel.gates.cleared` (features/auth/
 *      gates.ts), que tuvo este problema antes. Al cerrar sesión se borra.
 *   2. POR FORMA. La huella se calcula SOLA a partir de las claves de los
 *      esquemas (`libraryRowSchema`, `upNextRowSchema`): añadir o quitar una
 *      columna cambia la huella y tira lo guardado sin que nadie se acuerde de
 *      subir un número a mano. Lo que la huella no ve —un `string` que pasa a
 *      `number` con el mismo nombre— lo ve zod, que valida SIEMPRE antes de
 *      hidratar. Una instantánea que no valida no se pinta rota: se descarta.
 *   3. SIN ESTADO OPTIMISTA. Solo se escribe lo que ya confirmó el servidor:
 *      nada mientras haya una mutación en vuelo (seguir/dejar de seguir, marcar
 *      visto), nada invalidado y nada en pleno refetch. Un `setQueryData`
 *      optimista que el servidor rechace no llega a tocar el disco.
 *   4. SIN DISCO SE VIVE IGUAL. Ventana privada o almacenamiento denegado:
 *      todo esto se calla y la app arranca exactamente como antes.
 *
 * POR PREFIJO Y NO POR CLAVE EXACTA. `qk.library` se está partiendo por medio
 * (tv/movie/game bajo un prefijo común), así que lo que decide es `key[0]`: hoy
 * casa `["library"]` y mañana casará `["library","movie"]` sin tocar esto. */

const USER_KEY = "user-v1";
/** Más corta que la de metadatos a propósito: son datos que cambian todos los
 *  días, y una biblioteca de hace un mes no merece pintarse ni un instante. */
const USER_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Lo que se guarda de la cuenta, y con qué se valida al volver a leerlo.
 *  `rpc_up_next` entra con la biblioteca porque es lo primero que pinta Esta
 *  noche y cuesta lo mismo tratarlo: una lista de filas con su esquema. */
const USER_QUERIES = [
  { prefix: "library", row: libraryRowSchema },
  { prefix: "upNext", row: upNextRowSchema },
] as const;

export interface UserSnapshot {
  userId: string;
  /** Huella de la FORMA de las filas; ver `shapeFingerprint`. */
  shape: string;
  savedAt: number;
  state: DehydratedState;
}

/** ¿Va esta clave a la instantánea de la cuenta? Mira solo el primer tramo, que
 *  es el prefijo estable — ver la nota de arriba. */
export function isPersistableUserKey(key: QueryKey): boolean {
  return USER_QUERIES.some((q) => key[0] === q.prefix);
}

function schemaFor(key: QueryKey) {
  return USER_QUERIES.find((q) => key[0] === q.prefix)?.row;
}

/** Un número corto y estable a partir de los nombres de columna de cada
 *  esquema. No pretende ser criptográfico: solo tiene que CAMBIAR cuando cambie
 *  la forma de la fila, y ser el mismo entre dos cargas de la misma versión. */
export function shapeFingerprint(): string {
  const source = USER_QUERIES.map(
    (q) => `${q.prefix}:${Object.keys(q.row.shape).sort().join(",")}`,
  ).join("|");
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  return `s${(hash >>> 0).toString(36)}`;
}

/**
 * Los cuatro cierres, en un sitio que se puede probar sin navegador: decide si
 * una instantánea leída del disco puede pintarse para `userId`, y devuelve el
 * estado ya validado o `undefined`.
 */
export function acceptUserSnapshot(
  snapshot: UserSnapshot | undefined,
  userId: string | undefined,
  now = Date.now(),
): DehydratedState | undefined {
  if (!snapshot || !userId) return undefined;
  if (snapshot.userId !== userId) return undefined; // otra cuenta en este aparato
  if (snapshot.shape !== shapeFingerprint()) return undefined; // cambió la fila
  if (now - snapshot.savedAt > USER_MAX_AGE_MS) return undefined;

  const queries = snapshot.state?.queries ?? [];
  for (const query of queries) {
    const row = schemaFor(query.queryKey);
    // Algo que no es ni biblioteca ni up-next no debería estar aquí; si está,
    // la instantánea no es de esta versión y no se pinta ninguna parte de ella.
    if (!row) return undefined;
    if (!z.array(row).safeParse(query.state.data).success) return undefined;
  }
  return snapshot.state;
}

/** Hidrata lo que el servidor ya dijo, si pasa los cierres. Devuelve si pintó.
 *
 *  Hidratar sobre una consulta que YA está pidiendo es seguro y es justo lo que
 *  se quiere: TanStack solo escribe si lo guardado es más nuevo que lo que hay
 *  (una consulta en vuelo no tiene nada), y la respuesta de verdad, cuando
 *  llegue, sustituye esto sin preguntar. Eso es el stale-while-revalidate. */
export function hydrateUserSnapshot(
  client: QueryClient,
  snapshot: UserSnapshot | undefined,
  userId: string | undefined,
): boolean {
  const state = acceptUserSnapshot(snapshot, userId);
  if (!state) return false;
  hydrate(client, state);
  /* Y se marca rancio ACTO SEGUIDO, que es la otra mitad del trato.
   *
   * Sin esto lo hidratado llega con la hora a la que se guardó, y los 30 s de
   * `staleTime` del cliente (main.tsx) lo dan por fresco: una recarga dentro de
   * ese medio minuto pintaba el disco y NO PEDÍA NADA. Se vio en el e2e, que
   * contaba las peticiones — la pantalla estaba bien y la revalidación no
   * existía. Invalidar aquí, sin refetch (lo pide quien monte la consulta),
   * deja lo pintado donde está y garantiza el viaje. */
  client.invalidateQueries({
    predicate: (query) => isPersistableUserKey(query.queryKey),
    refetchType: "none",
  });
  return true;
}

/** ¿Hay alguna mutación en vuelo? Entonces hay, o puede haber, una fila
 *  optimista en la caché y no se escribe nada hasta que el servidor conteste.
 *
 *  Mira TODAS las mutaciones y no solo las de la biblioteca a propósito: una
 *  mutación no dice qué consultas va a tocar, así que distinguirlas sería
 *  adivinar. El precio de esa red de más lo paga `watchUserCache`, que vuelve a
 *  intentarlo en vez de dejar la escritura por imposible. */
export function hasPendingMutations(client: QueryClient): boolean {
  return client.getMutationCache().getAll().some((m) => m.state.status === "pending");
}

/** Lo que se guardaría ahora mismo, o `undefined` si no hay nada que confirmar.
 *
 *  Separado de la escritura para que la regla de "sin estado optimista" se pueda
 *  comprobar en una prueba sin IndexedDB. */
export function buildUserSnapshot(
  client: QueryClient,
  userId: string | undefined,
): UserSnapshot | undefined {
  if (!userId || hasPendingMutations(client)) return undefined;

  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      isPersistableUserKey(query.queryKey) &&
      query.state.status === "success" &&
      // `idle` deja fuera lo que se está refrescando; `isInvalidated`, lo que
      // acaba de tocar una mutación y todavía no se ha vuelto a pedir.
      query.state.fetchStatus === "idle" &&
      !query.state.isInvalidated,
    shouldDehydrateMutation: () => false,
  });
  if (state.queries.length === 0) return undefined;
  return { userId, shape: shapeFingerprint(), savedAt: Date.now(), state };
}

/* ── la nota de quién entró el último ─────────────────────────────────────────
 * El id de la cuenta hace falta ANTES de montar nada, y la sesión de supabase
 * tarda un viaje a su almacén en aparecer. Se apunta aquí, igual que la nota de
 * los porteros, para poder hidratar en el arranque; `AuthProvider` comprueba
 * después contra la sesión de verdad y borra si no cuadra. */

const LAST_USER_KEY = "reel.query.user";

export function rememberUser(userId: string): void {
  try {
    if (localStorage.getItem(LAST_USER_KEY) !== userId) {
      localStorage.setItem(LAST_USER_KEY, userId);
    }
  } catch {
    // Sin almacenamiento se arranca como antes: pidiendo y esperando.
  }
}

export function lastKnownUser(): string | undefined {
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Borra el rastro de la cuenta: la nota y la instantánea. Al cerrar sesión, y
 *  también cuando la sesión de verdad no es la que decía la nota. */
export async function forgetUserCache(): Promise<void> {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Nada que borrar si no se pudo escribir.
  }
  if (typeof indexedDB === "undefined") return;
  try {
    await deleteRecord(USER_KEY);
  } catch {
    // Si no se puede borrar, el cierre por cuenta de `acceptUserSnapshot` sigue
    // impidiendo que lo de uno se le enseñe a otro.
  }
}

/** Lee la instantánea de la cuenta y la pinta si pasa los cierres. */
export async function restoreUserCache(
  client: QueryClient,
  userId: string | undefined,
): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !userId) return false;
  try {
    return hydrateUserSnapshot(client, await readRecord<UserSnapshot>(USER_KEY), userId);
  } catch {
    return false;
  }
}

/** Mantiene la instantánea al día. Lee la cuenta de la nota en cada escritura,
 *  así que no hay que volver a montarla cuando cambia la sesión. */
export function watchUserCache(client: QueryClient): () => void {
  if (typeof indexedDB === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let queued = false;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void persist(), ms);
  };

  const persist = async () => {
    if (writing) {
      queued = true;
      return;
    }
    /* Una mutación en vuelo no cancela la escritura, la aplaza.
     *
     * Quien dispara una escritura es un suceso de la caché, y puede no haber
     * otro en toda la sesión: si el único llega mientras viaja CUALQUIER
     * mutación —importar Steam tarda minutos—, dejarlo correr significaba
     * terminar la visita sin instantánea y que la siguiente volviera a esperar
     * al rollup entero. Volver a mirar dentro de un momento no cuesta nada. */
    if (hasPendingMutations(client)) {
      schedule(500);
      return;
    }
    writing = true;
    try {
      const snapshot = buildUserSnapshot(client, lastKnownUser());
      if (snapshot) await writeRecord(USER_KEY, snapshot);
    } catch {
      // Igual que arriba: el disco es una mejora, no un requisito.
    } finally {
      writing = false;
      if (queued) {
        queued = false;
        void persist();
      }
    }
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event?.query && !isPersistableUserKey(event.query.queryKey)) return;
    schedule(250);
  });

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
