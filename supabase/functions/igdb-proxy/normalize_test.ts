// Tests de la traducción IGDB → `titles`. Los corre el job `edge` de CI
// (`deno test supabase/functions/`).
//
// La propiedad que vigila la mitad de este fichero: **una fecha que IGDB no ha
// prometido no puede acabar contando como un lanzamiento**. IGDB devuelve un
// timestamp concreto para "Q4 2027", y creérselo pinta un catálogo entero de
// días inventados que parecen oficiales. Cada caso de `windowEnd` es una forma
// de esa trampa.
import { assertEquals } from "jsr:@std/assert@1";
import {
  beatSeconds,
  canonicalRelease,
  gameRow,
  platformReleases,
  precisionOf,
  rating10,
  steamAppid,
  studio,
  windowEnd,
} from "./normalize.ts";

/* ── precisionOf: el enum viejo, la tabla nueva, y ninguno ─────────────── */

Deno.test("precisionOf prefiere date_format al enum deprecado", () => {
  // IGDB está migrando enums a tablas y durante la transición manda los dos.
  // Si ganara el viejo, el día que lo retiren todo pasaría a ser 'tbd' de
  // golpe y el catálogo entero se quedaría sin fechas sin que nada fallara.
  assertEquals(precisionOf({ category: 7, date_format: { format: "YYYYMMMMDD" } }), "day");
});

Deno.test("precisionOf cae al enum cuando no hay tabla", () => {
  assertEquals(precisionOf({ category: 0 }), "day");
  assertEquals(precisionOf({ category: 1 }), "month");
  assertEquals(precisionOf({ category: 2 }), "year");
  assertEquals(precisionOf({ category: 3 }), "q1");
  assertEquals(precisionOf({ category: 6 }), "q4");
  assertEquals(precisionOf({ category: 7 }), "tbd");
});

Deno.test("una fila que no dice su formato no se cree", () => {
  // Sin formato no hay forma de saber si el timestamp es un día real. 'tbd'
  // deja el juego sin fecha, que es peor que una fecha buena y mejor que una
  // inventada.
  assertEquals(precisionOf({ date: 1_800_000_000 }), "tbd");
  assertEquals(precisionOf({}), "tbd");
  assertEquals(precisionOf(null), "tbd");
});

/* ── windowEnd: el último día del periodo prometido ─────────────────────── */

Deno.test("un día exacto se guarda tal cual", () => {
  assertEquals(windowEnd({ y: 2027, m: 3, d: 12 }, "day"), "2027-03-12");
});

Deno.test("un mes se guarda como su último día, bisiestos incluidos", () => {
  assertEquals(windowEnd({ y: 2027, m: 11 }, "month"), "2027-11-30");
  assertEquals(windowEnd({ y: 2027, m: 2 }, "month"), "2027-02-28");
  assertEquals(windowEnd({ y: 2028, m: 2 }, "month"), "2028-02-29");
});

Deno.test("un trimestre se guarda como su último día", () => {
  assertEquals(windowEnd({ y: 2027 }, "q1"), "2027-03-31");
  assertEquals(windowEnd({ y: 2027 }, "q2"), "2027-06-30");
  assertEquals(windowEnd({ y: 2027 }, "q3"), "2027-09-30");
  assertEquals(windowEnd({ y: 2027 }, "q4"), "2027-12-31");
});

Deno.test("un año se guarda como su último día", () => {
  assertEquals(windowEnd({ y: 2027 }, "year"), "2027-12-31");
});

Deno.test("Q4 no empieza en octubre", () => {
  // El caso que da nombre al fichero. IGDB manda el 1 de octubre como
  // timestamp de un "Q4 2027"; guardarlo daría el juego por salido tres meses
  // antes de que exista. La fecha guardada tiene que ser el final del periodo.
  const row = { y: 2027, m: 10, d: 1, date: 1_822_521_600, category: 6 };
  assertEquals(windowEnd(row, precisionOf(row)), "2027-12-31");
});

Deno.test("TBD no tiene fecha", () => {
  assertEquals(windowEnd({ y: 2027 }, "tbd"), null);
});

Deno.test("sin año no hay periodo", () => {
  assertEquals(windowEnd({}, "year"), null);
  assertEquals(windowEnd(null, "day"), null);
});

Deno.test("sin y/m/d se recurre al timestamp", () => {
  // Filas antiguas de IGDB traen solo el unix. 2027-03-12T00:00:00Z.
  assertEquals(windowEnd({ date: 1_804_809_600 }, "day"), "2027-03-12");
});

Deno.test("un 'día exacto' sin día se degrada al final del mes", () => {
  // Contradicción de la fuente: el formato promete un día que no viene. Se
  // guarda lo único que sí se sabe en vez de inventar el 1.
  assertEquals(windowEnd({ y: 2027, m: 6 }, "day"), "2027-06-30");
});

/* ── platformReleases: una fila por plataforma × región ─────────────────── */

const NAMES = new Map([[48, "PlayStation 5"], [130, "Nintendo Switch"], [6, "PC (Microsoft Windows)"]]);

Deno.test("de cada plataforma se guarda la fecha más temprana", () => {
  // La misma PS5 sale en tres regiones con tres días. "¿Cuándo salió?" tiene
  // una sola respuesta y es la primera.
  const rows = [
    { platform: 48, y: 2027, m: 3, d: 20, category: 0, region: 1 },
    { platform: 48, y: 2027, m: 3, d: 12, category: 0, region: 2 },
    { platform: 48, y: 2027, m: 4, d: 2, category: 0, region: 5 },
  ];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
  });
});

Deno.test("cada plataforma lleva su propia precisión", () => {
  const rows = [
    { platform: 48, y: 2027, m: 3, d: 12, category: 0 },
    { platform: 130, y: 2027, category: 6 },
  ];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
    "Nintendo Switch": { date: "2027-12-31", precision: "q4" },
  });
});

Deno.test("una plataforma desconocida se descarta, no se agrupa", () => {
  // Una fecha sin plataforma no se puede pintar ni filtrar; guardarla bajo un
  // "Otras" solo sirve para que un día alguien la cuente como si fuera algo.
  const rows = [{ platform: 999, y: 2027, m: 1, d: 1, category: 0 }];
  assertEquals(platformReleases(rows, NAMES), {});
});

Deno.test("platform expandido como objeto también vale", () => {
  const rows = [{ platform: { id: 48, name: "PlayStation 5" }, y: 2027, m: 3, d: 12, category: 0 }];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
  });
});

Deno.test("una fila TBD no ocupa la plataforma", () => {
  // Sin esto, un "PS5: TBD" junto a un "PS5: 12 de marzo" podía dejar la
  // plataforma sin fecha según el orden en que llegaran.
  const rows = [
    { platform: 48, category: 7 },
    { platform: 48, y: 2027, m: 3, d: 12, category: 0 },
  ];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
  });
});

/* ── canonicalRelease: la fecha que ordena y que decide si ya salió ─────── */

Deno.test("la canónica es la más temprana de todas las plataformas", () => {
  const byPlatform = {
    "Nintendo Switch": { date: "2027-12-31", precision: "q4" as const },
    "PlayStation 5": { date: "2027-03-12", precision: "day" as const },
  };
  assertEquals(canonicalRelease(byPlatform), { date: "2027-03-12", precision: "day" });
});

Deno.test("un juego sin fechas se queda sin fecha", () => {
  // Y no en el día 1 de nada: `first_air_date` null deja el episodio sintético
  // sin air_datetime, o sea el juego en "próximamente" hasta que IGDB fecha.
  assertEquals(canonicalRelease({}), { date: null, precision: "tbd" });
});

/* ── Mapeos ─────────────────────────────────────────────────────────────── */

Deno.test("la nota de IGDB se normaliza sobre 10", () => {
  assertEquals(rating10({ total_rating: 87.4 }), 8.7);
  assertEquals(rating10({ total_rating: 100 }), 10);
});

Deno.test("manda total_rating sobre rating", () => {
  // `rating` son solo los usuarios de IGDB, que en un juego poco jugado son
  // cuatro votos; total_rating incluye a la crítica.
  assertEquals(rating10({ total_rating: 87, rating: 40 }), 8.7);
  assertEquals(rating10({ rating: 40 }), 4);
});

Deno.test("un juego sin nota no tiene nota", () => {
  assertEquals(rating10({}), null);
  assertEquals(rating10({ total_rating: null }), null);
});

Deno.test("el appid de Steam sale del enum viejo o de la tabla nueva", () => {
  assertEquals(steamAppid([{ category: 1, uid: "1245620" }]), 1_245_620);
  assertEquals(
    steamAppid([{ external_game_source: { name: "Steam" }, uid: "1245620" }]),
    1_245_620,
  );
});

Deno.test("otras tiendas no son Steam", () => {
  assertEquals(steamAppid([{ category: 26, uid: "epic-slug" }]), null);
  assertEquals(steamAppid([]), null);
  assertEquals(steamAppid(undefined), null);
});

Deno.test("el estudio es el desarrollador, no la distribuidora", () => {
  const involved = [
    { publisher: true, company: { name: "Bandai Namco" } },
    { developer: true, company: { name: "FromSoftware" } },
  ];
  assertEquals(studio(involved), "FromSoftware");
});

Deno.test("sin developer marcado vale la primera compañía", () => {
  assertEquals(studio([{ publisher: true, company: { name: "Devolver" } }]), "Devolver");
  assertEquals(studio([]), null);
});

Deno.test("sin tiempos, beat_seconds no se escribe", () => {
  // undefined, no {}: la regla de no vaciar lo que otro upsert ya escribió.
  assertEquals(beatSeconds(null), undefined);
  assertEquals(beatSeconds({ hastily: 0 }), undefined);
  assertEquals(beatSeconds({ hastily: 43200, normally: 86400 }), {
    hastily: 43200,
    normally: 86400,
  });
});

/* ── gameRow: la fila entera ────────────────────────────────────────────── */

const DETAIL = {
  id: 119171,
  name: "Silksong",
  summary: "Un bicho con aguja.",
  cover: { image_id: "co1rgi" },
  artworks: [{ image_id: "ar2xyz" }],
  genres: [{ name: "Platform" }, { name: "Adventure" }],
  platforms: [{ id: 48, name: "PlayStation 5" }, { id: 130, name: "Nintendo Switch" }],
  release_dates: [
    { platform: 130, y: 2027, m: 3, d: 12, category: 0 },
    { platform: 48, y: 2027, category: 6 },
  ],
  involved_companies: [{ developer: true, company: { name: "Team Cherry" } }],
  total_rating: 91.2,
  total_rating_count: 40,
  hypes: 1200,
  external_games: [{ category: 1, uid: "1030300" }],
};

Deno.test("gameRow arma la fila que espera 0069", () => {
  const row = gameRow(DETAIL, { hastily: 43200, normally: 86400, completely: 216000 });

  assertEquals(row.kind, "game");
  assertEquals(row.tmdb_id, 119171); // el id de IGDB, namespaced por kind
  assertEquals(row.name, "Silksong");
  assertEquals(row.poster_path, "co1rgi"); // el hash, no una ruta de TMDB
  assertEquals(row.platforms, ["Nintendo Switch", "PlayStation 5"]); // ordenadas
  assertEquals(row.network, "Team Cherry");
  assertEquals(row.vote_average, 9.1);
  assertEquals(row.popularity, 1240);
  assertEquals(row.steam_appid, 1_030_300);
  assertEquals(row.beat_seconds, { hastily: 43200, normally: 86400, completely: 216000 });
  assertEquals(row.platform_releases, {
    "Nintendo Switch": { date: "2027-03-12", precision: "day" },
    "PlayStation 5": { date: "2027-12-31", precision: "q4" },
  });
});

Deno.test("la fecha canónica del juego es la de la plataforma que llega antes", () => {
  const row = gameRow(DETAIL);
  assertEquals(row.first_air_date, "2027-03-12");
  assertEquals(row.release_precision, "day");
});

Deno.test("un juego solo anunciado no finge una fecha", () => {
  // Lo que ve la biblioteca: sin first_air_date, el episodio sintético queda
  // sin air_datetime y el juego se queda en "próximamente" en vez de aparecer
  // como salido el 1 de enero de un año cualquiera.
  const row = gameRow({ id: 1, name: "Sin fecha", platforms: [{ id: 48, name: "PlayStation 5" }] });
  assertEquals(row.first_air_date, null);
  assertEquals(row.release_precision, "tbd");
  assertEquals(row.platform_releases, {});
});

Deno.test("sin tiempos de IGDB la columna no viaja en el upsert", () => {
  assertEquals("beat_seconds" in gameRow(DETAIL, null), false);
});
