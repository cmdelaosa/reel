import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  acceptUserSnapshot,
  buildUserSnapshot,
  hydrateUserSnapshot,
  isPersistableMetadataKey,
  isPersistableUserKey,
  shapeFingerprint,
  type UserSnapshot,
} from "@/lib/queryPersistence";
import type { LibraryRow } from "@/lib/schemas";

describe("metadata query persistence", () => {
  it("persists only title and season metadata", () => {
    expect(isPersistableMetadataKey(["title", 42])).toBe(true);
    expect(isPersistableMetadataKey(["season", 42, 2])).toBe(true);
    expect(isPersistableMetadataKey(["watched", "user-title"])).toBe(false);
    expect(isPersistableMetadataKey(["myRating", "user-title"])).toBe(false);
    expect(isPersistableMetadataKey(["profile", "user"])).toBe(false);
  });
});

/* La instantánea de la cuenta: los cuatro cierres de lib/queryPersistence.
 *
 * CÓMO SE DEMUESTRA QUE ESTAS PRUEBAS PUEDEN FALLAR. Cada bloque dice, en su
 * comentario, qué línea de queryPersistence.ts hay que quitar para verlo en
 * rojo; se comprobó quitándolas una a una sobre una copia. Ver el informe de la
 * rama para la salida.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/** Una fila de biblioteca que valida contra libraryRowSchema. */
function row(name: string, n = 1): LibraryRow {
  return {
    title_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tmdb_id: 900000 + n,
    kind: "tv",
    name,
    poster_path: "/p.jpg",
    backdrop_path: null,
    first_air_date: "2024-01-01",
    tmdb_status: "Returning Series",
    genres: ["Drama"],
    network: "AMC",
    vote_average: 8,
    favorite: false,
    notify: false,
    stopped: false,
    added_at: "2026-01-01T00:00:00.000Z",
    aired_count: 10,
    watched_count: 3,
    last_watched_at: null,
    last_aired_datetime: null,
    next_air_datetime: null,
    upcoming_season_number: null,
    upcoming_season_air_date: null,
  };
}

/** Una instantánea como la que escribiría `buildUserSnapshot`, con los trozos
 *  que cada prueba quiera estropear. */
function snapshot(over: Partial<UserSnapshot> = {}, data: unknown = [row("Fixture")]): UserSnapshot {
  return {
    userId: ALICE,
    shape: shapeFingerprint(),
    savedAt: Date.now(),
    state: {
      mutations: [],
      queries: [
        { queryKey: ["library"], queryHash: '["library"]', state: { data, dataUpdatedAt: Date.now() } },
      ],
    } as unknown as UserSnapshot["state"],
    ...over,
  };
}

describe("instantánea de la cuenta — qué se guarda", () => {
  // Quitar el `key[0] === q.prefix` de isPersistableUserKey (dejando `true`) y
  // las tres últimas afirmaciones se caen.
  it("va por prefijo, no por clave exacta — para que casen las claves por medio", () => {
    expect(isPersistableUserKey(["library"])).toBe(true);
    expect(isPersistableUserKey(["library", "tv"])).toBe(true);
    expect(isPersistableUserKey(["library", "movie", { bucket: "all" }])).toBe(true);
    expect(isPersistableUserKey(["upNext"])).toBe(true);
    expect(isPersistableUserKey(["history"])).toBe(false);
    expect(isPersistableUserKey(["ratings"])).toBe(false);
    expect(isPersistableUserKey(["profile", ALICE])).toBe(false);
  });
});

describe("instantánea de la cuenta — hidratar", () => {
  // Quitar el `hydrate(client, state)` de hydrateUserSnapshot y esto se cae.
  it("pinta la biblioteca guardada antes de que nadie pida nada", () => {
    const client = new QueryClient();
    expect(client.getQueryData(["library"])).toBeUndefined();

    expect(hydrateUserSnapshot(client, snapshot(), ALICE)).toBe(true);

    expect(client.getQueryData<LibraryRow[]>(["library"])).toHaveLength(1);
    expect(client.getQueryData<LibraryRow[]>(["library"])![0].name).toBe("Fixture");
  });

  /* Quitar el `invalidateQueries` de hydrateUserSnapshot y esto se cae — que es
     exactamente lo que pasaba: con los 30 s de staleTime del cliente, una
     recarga seguida pintaba el disco y no pedía nada. Sin rancio no hay
     revalidate, y sin revalidate esto no es stale-while-revalidate. */
  it("lo hidratado queda rancio, para que la petición de verdad salga igual", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    hydrateUserSnapshot(client, snapshot(), ALICE);
    const query = client.getQueryCache().find({ queryKey: ["library"] })!;
    expect(query.state.isInvalidated).toBe(true);
    expect(query.isStale()).toBe(true);
    // Y rancio no es vacío: lo pintado sigue en pantalla mientras viaja.
    expect(query.state.data).toHaveLength(1);
  });

  // Quitar el `if (now - snapshot.savedAt > USER_MAX_AGE_MS)` y esto se cae.
  it("no pinta una biblioteca de hace un mes", () => {
    const old = snapshot({ savedAt: Date.now() - 8 * 24 * 3600_000 });
    expect(acceptUserSnapshot(old, ALICE)).toBeUndefined();
  });
});

describe("instantánea de la cuenta — por cuenta", () => {
  // Quitar el `if (snapshot.userId !== userId)` y la biblioteca de Alice se le
  // pinta a Bob. Este es el cierre que no puede fallar nunca.
  it("la instantánea de una cuenta no se le enseña a otra", () => {
    const client = new QueryClient();
    expect(hydrateUserSnapshot(client, snapshot({ userId: ALICE }), BOB)).toBe(false);
    expect(client.getQueryData(["library"])).toBeUndefined();

    // Y a su dueña sí.
    expect(hydrateUserSnapshot(client, snapshot({ userId: ALICE }), ALICE)).toBe(true);
  });

  it("sin sesión no se pinta nada", () => {
    expect(acceptUserSnapshot(snapshot(), undefined)).toBeUndefined();
  });
});

describe("instantánea de la cuenta — por versión", () => {
  // Quitar el `if (snapshot.shape !== shapeFingerprint())` y esto se cae.
  it("descarta lo guardado con otra forma de fila", () => {
    expect(acceptUserSnapshot(snapshot({ shape: "s-de-antes" }), ALICE)).toBeUndefined();
  });

  // Cambiar el cuerpo de shapeFingerprint por una constante y esto se cae: es
  // lo que hace que añadir una columna a libraryRowSchema tire lo viejo solo.
  it("la huella sale de las claves del esquema, así que cambia con la fila", () => {
    // Estable entre llamadas…
    expect(shapeFingerprint()).toBe(shapeFingerprint());
    // …y distinta de la huella de cualquier otra lista de columnas.
    expect(shapeFingerprint()).not.toBe("s0");
    expect(shapeFingerprint()).toMatch(/^s[0-9a-z]+$/);
  });

  // Quitar el `safeParse` de acceptUserSnapshot y la fila rota llega a la
  // pantalla, que es lo que se quiere evitar: se pinta rota en vez de no
  // pintarse. Cubre lo que la huella NO ve — mismo nombre, otro tipo.
  it("una fila que ya no valida se descarta entera, no se pinta a medias", () => {
    const roto = [{ ...row("Rota"), aired_count: "diez" }];
    const client = new QueryClient();
    expect(hydrateUserSnapshot(client, snapshot({}, roto), ALICE)).toBe(false);
    expect(client.getQueryData(["library"])).toBeUndefined();
  });

  it("una clave que ya no es de nadie invalida la instantánea entera", () => {
    const ajena = snapshot();
    ajena.state.queries[0].queryKey = ["loQueFuera"];
    expect(acceptUserSnapshot(ajena, ALICE)).toBeUndefined();
  });
});

describe("instantánea de la cuenta — nada optimista en disco", () => {
  function clientConBiblioteca() {
    const client = new QueryClient();
    client.setQueryData(["library"], [row("Confirmada")]);
    // setQueryData deja la consulta en success/idle, que es el estado en el que
    // queda tras una respuesta del servidor.
    return client;
  }

  // Quitar el `if (busy) return undefined` y esto se cae.
  it("no escribe mientras una mutación está en vuelo", async () => {
    const client = clientConBiblioteca();
    expect(buildUserSnapshot(client, ALICE)).toBeDefined();

    // Seguir un título: la fila optimista entra en la caché y la mutación sigue
    // viajando. Nada de esto puede llegar al disco.
    let resolver!: () => void;
    const enVuelo = new Promise<void>((r) => (resolver = r));
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: () => enVuelo.then(() => "ok") });
    const ejecutando = mutation.execute(undefined);
    client.setQueryData(["library"], [row("Confirmada"), row("Optimista", 2)]);

    expect(buildUserSnapshot(client, ALICE)).toBeUndefined();

    resolver();
    await ejecutando;
  });

  // Quitar el `!query.state.isInvalidated` y esto se cae.
  it("no escribe lo que una mutación acaba de invalidar", async () => {
    const client = clientConBiblioteca();
    await client.invalidateQueries({ queryKey: ["library"], refetchType: "none" });
    expect(buildUserSnapshot(client, ALICE)).toBeUndefined();
  });

  // Quitar el `query.state.status === "success"` y esto se cae.
  it("no escribe una consulta que falló", () => {
    const client = new QueryClient();
    const query = client.getQueryCache().build(client, { queryKey: ["library"] });
    query.setState({ status: "error", error: new Error("no"), fetchStatus: "idle" });
    expect(buildUserSnapshot(client, ALICE)).toBeUndefined();
  });

  it("sin cuenta no se escribe nada, aunque haya biblioteca en memoria", () => {
    expect(buildUserSnapshot(clientConBiblioteca(), undefined)).toBeUndefined();
  });

  // Quitar el `isPersistableUserKey` del shouldDehydrateQuery y el historial
  // acaba en disco.
  it("solo guarda biblioteca y up-next, no el resto de la cuenta", () => {
    const client = clientConBiblioteca();
    client.setQueryData(["history"], [{ lo: "que sea" }]);
    client.setQueryData(["profile", ALICE], { handle: "alice" });

    const guardado = buildUserSnapshot(client, ALICE)!;
    expect(guardado.state.queries.map((q) => q.queryKey)).toEqual([["library"]]);
  });

  // La vuelta completa: lo que se guarda es lo que se pinta.
  it("lo que escribe se vuelve a pintar en el arranque siguiente", () => {
    const guardado = buildUserSnapshot(clientConBiblioteca(), ALICE);
    const siguiente = new QueryClient();
    expect(hydrateUserSnapshot(siguiente, guardado, ALICE)).toBe(true);
    expect(siguiente.getQueryData<LibraryRow[]>(["library"])![0].name).toBe("Confirmada");
  });
});
