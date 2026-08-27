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
  apicalypseTerm,
  capturasRecortadas,
  edades,
  gameSearchRow,
  metacritic,
  steamReviews,
  videosRecortados,
  webOficial,
  beatSeconds,
  canonicalRelease,
  gameRow,
  platformReleases,
  precisionOf,
  couldBeOnSteam,
  rating10,
  steamAppid,
  studio,
  windowEnd,
} from "./normalize.ts";

/* ── precisionOf: el enum viejo, la tabla nueva, y ninguno ─────────────── */

Deno.test("los formatos son los que devuelve la API, no los de la documentación", () => {
  // api-docs.igdb.com llama a estos dos YYYYMMMMDD y YYYYMMMM, con Ms de más.
  // La API manda YYYYMMDD y YYYYMM. Con los nombres de la documentación, el
  // formato más común de todos no se reconocía, cada juego salía 'tbd' y el
  // catálogo entero se quedaba sin fechas — en silencio, que es lo peor.
  assertEquals(precisionOf({ date_format: { id: 0, format: "YYYYMMDD" } }), "day");
  assertEquals(precisionOf({ date_format: { id: 1, format: "YYYYMM" } }), "month");
  assertEquals(precisionOf({ date_format: { id: 2, format: "YYYY" } }), "year");
  assertEquals(precisionOf({ date_format: { id: 3, format: "YYYYQ1" } }), "q1");
  assertEquals(precisionOf({ date_format: { id: 6, format: "YYYYQ4" } }), "q4");
  assertEquals(precisionOf({ date_format: { id: 7, format: "TBD" } }), "tbd");
});

Deno.test("si la etiqueta cambia, queda el id", () => {
  // El id (0-7) es la misma numeración de siempre. Es el respaldo por si IGDB
  // retoca los textos, que ya lo ha hecho una vez.
  assertEquals(precisionOf({ date_format: { id: 0, format: "lo que sea" } }), "day");
  assertEquals(precisionOf({ date_format: { id: 6 } }), "q4");
});

Deno.test("una fila que no dice su formato no se cree", () => {
  // Sin formato no hay forma de saber si el timestamp es un día real. 'tbd'
  // deja el juego sin fecha, que es peor que una fecha buena y mejor que una
  // inventada. `category` entra aquí a propósito: está deprecado y la API ya
  // no lo manda, así que una fila que solo lo trajera no es de fiar.
  assertEquals(precisionOf({ date: 1_800_000_000 }), "tbd");
  assertEquals(precisionOf({ category: 0 }), "tbd");
  assertEquals(precisionOf({}), "tbd");
  assertEquals(precisionOf(null), "tbd");
});

/* Los formatos tal y como los devuelve la API, para no repetirlos en cada
   fixture. La expansión de IGDB trae siempre el id junto al texto. */
const DAY = { id: 0, format: "YYYYMMDD" };
const Q2 = { id: 4, format: "YYYYQ2" };
const Q4 = { id: 6, format: "YYYYQ4" };
const TBD = { id: 7, format: "TBD" };

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

Deno.test("en un periodo ancho manda la etiqueta, no el timestamp", () => {
  // El caso que da nombre al fichero. Una fila de "Q2 2027" trae un timestamp
  // concreto —aquí el 1 de abril— que nadie ha prometido; creérselo daría el
  // juego por salido tres meses antes de que exista. Lo que se guarda es el
  // final del periodo que la etiqueta anuncia.
  const row = { y: 2027, m: 4, d: 1, date: 1_806_796_800, date_format: Q2 };
  assertEquals(windowEnd(row, precisionOf(row)), "2027-06-30");
});

Deno.test("una fecha de día exacto saca el día del timestamp", () => {
  // Comprobado contra la API el 24-ago-2026: IGDB NO manda `d`, ni siquiera en
  // las fechas de día exacto. Silksong llega con y=2025, m=9, sin día, y el 4
  // de septiembre solo está en el unix. Leyendo únicamente y/m se guardaba el
  // 30 de septiembre: veintiséis días de más, y el juego contando como no
  // salido casi un mes después de estarlo.
  const row = { y: 2025, m: 9, date: 1_756_944_000, date_format: DAY };
  assertEquals(windowEnd(row, precisionOf(row)), "2025-09-04");
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

Deno.test("el día del timestamp no se mezcla con el año de la fila", () => {
  // Una fila que dice 2026 con un timestamp del 31-dic-2025 —lo que deja un
  // lanzamiento de fin de año con husos por medio— no puede producir
  // 2026-12-31, que es un año entero de más y no está en ninguna de las dos
  // fuentes. Si el día sale del timestamp, la fecha entera sale del timestamp.
  const row = { y: 2026, date: 1_767_139_200, date_format: DAY }; // 2025-12-31
  assertEquals(windowEnd(row, "day"), "2025-12-31");
});

Deno.test("un 'día exacto' sin día NI timestamp se degrada al final del mes", () => {
  // Contradicción de la fuente: el formato promete un día que no viene por
  // ningún lado. Se guarda lo único que sí se sabe en vez de inventar el 1.
  assertEquals(windowEnd({ y: 2027, m: 6 }, "day"), "2027-06-30");
});

/* ── platformReleases: una fila por plataforma × región ─────────────────── */

const NAMES = new Map([[48, "PlayStation 5"], [130, "Nintendo Switch"], [6, "PC (Microsoft Windows)"]]);

Deno.test("de cada plataforma se guarda la fecha más temprana", () => {
  // La misma PS5 sale en tres regiones con tres días. "¿Cuándo salió?" tiene
  // una sola respuesta y es la primera.
  const rows = [
    { platform: 48, y: 2027, m: 3, d: 20, date_format: DAY, region: 1 },
    { platform: 48, y: 2027, m: 3, d: 12, date_format: DAY, region: 2 },
    { platform: 48, y: 2027, m: 4, d: 2, date_format: DAY, region: 5 },
  ];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
  });
});

Deno.test("cada plataforma lleva su propia precisión", () => {
  const rows = [
    { platform: 48, y: 2027, m: 3, d: 12, date_format: DAY },
    { platform: 130, y: 2027, date_format: Q4 },
  ];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
    "Nintendo Switch": { date: "2027-12-31", precision: "q4" },
  });
});

Deno.test("una plataforma desconocida se descarta, no se agrupa", () => {
  // Una fecha sin plataforma no se puede pintar ni filtrar; guardarla bajo un
  // "Otras" solo sirve para que un día alguien la cuente como si fuera algo.
  const rows = [{ platform: 999, y: 2027, m: 1, d: 1, date_format: DAY }];
  assertEquals(platformReleases(rows, NAMES), {});
});

Deno.test("platform expandido como objeto también vale", () => {
  const rows = [{ platform: { id: 48, name: "PlayStation 5" }, y: 2027, m: 3, d: 12, date_format: DAY }];
  assertEquals(platformReleases(rows, NAMES), {
    "PlayStation 5": { date: "2027-03-12", precision: "day" },
  });
});

Deno.test("una fila TBD no ocupa la plataforma", () => {
  // Sin esto, un "PS5: TBD" junto a un "PS5: 12 de marzo" podía dejar la
  // plataforma sin fecha según el orden en que llegaran.
  const rows = [
    { platform: 48, date_format: TBD },
    { platform: 48, y: 2027, m: 3, d: 12, date_format: DAY },
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

/* ── El término de búsqueda ─────────────────────────────────────────────── */

Deno.test("una comilla en la búsqueda no cierra la cadena", () => {
  assertEquals(apicalypseTerm('Marvel\'s "Spider-Man"'), 'Marvel\'s \\"Spider-Man\\"');
});

Deno.test("una barra invertida se escapa ANTES que la comilla", () => {
  // El orden importa: escapando la comilla primero, la barra que se le pone
  // delante se volvería a escapar y saldría \\" — que cierra la cadena. Buscar
  // una barra suelta dejaba la consulta sin terminar, IGDB devolvía 400 y el
  // proxy lo traducía a un 502: un error de servidor por una tecla.
  assertEquals(apicalypseTerm("a\\b"), "a\\\\b");
  assertEquals(apicalypseTerm('a\\"'), 'a\\\\\\"');
});

Deno.test("los saltos de línea no entran en la consulta", () => {
  assertEquals(apicalypseTerm("zelda\n\nocarina"), "zelda ocarina");
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

/* ── couldBeOnSteam: lo que la tienda de Steam no puede vender ─────────── */

Deno.test("un juego de ordenador puede estar en Steam", () => {
  assertEquals(couldBeOnSteam(["PC (Microsoft Windows)"]), true);
  assertEquals(couldBeOnSteam(["Linux", "Mac", "PlayStation 4"]), true);
  // Como los nombra IGDB, y en cualquier caja: la lista viene de su catálogo.
  assertEquals(couldBeOnSteam(["pc (microsoft windows)"]), true);
});

Deno.test("un exclusivo de SteamVR es lo más de Steam que hay", () => {
  // El nombre es el de IGDB y va sin espacio. Escrito "steam vr" la línea no
  // casaba con nada, y Half-Life: Alyx —que no tiene otra plataforma— habría
  // perdido su appid al primer refresco de su ficha.
  assertEquals(couldBeOnSteam(["SteamVR"], "2020-03-23"), true);
  assertEquals(couldBeOnSteam(["Oculus Rift", "SteamVR"], "2018-07-31"), true);
  // Y uno de VR que no pasa por Steam sigue siendo un no.
  assertEquals(couldBeOnSteam(["Oculus Quest", "PlayStation VR"], "2019-11-07"), false);
});

Deno.test("los de DOS que Steam vende envueltos en DOSBox, también", () => {
  // Sin esta línea la comprobación se llevaría por delante el Doom del 93 y
  // medio catálogo de los noventa, que en IGDB son de "DOS" y en Steam están.
  assertEquals(couldBeOnSteam(["DOS"], "1993-12-10"), true);
});

Deno.test("un exclusivo de consola YA SALIDO no", () => {
  // El caso real del 27-ago-2026: IGDB tiene el appid 374900 (ABC Murders de
  // 2016) colgado también del ABC Murders de 2009, que solo salió en DS.
  assertEquals(couldBeOnSteam(["Nintendo DS"], "2009-11-09"), false);
  assertEquals(couldBeOnSteam(["PlayStation 2", "Xbox"], "2004-03-01"), false);
});

Deno.test("uno sin salir tiene la lista a medias, así que no se veta", () => {
  // Se anuncia para consola y aparece en Steam meses después; IGDB lo añade
  // cuando le llega. Vetarlo aquí sería borrarle el appid a media pestaña de
  // novedades.
  const now = new Date("2026-08-27T00:00:00Z");
  assertEquals(couldBeOnSteam(["Nintendo Switch"], "2027-03-12", now), true);
  assertEquals(couldBeOnSteam(["Nintendo Switch"], null, now), true);
});

Deno.test("sin plataformas es que no lo sabemos, no que no", () => {
  // Descartar por no saber perdería juegos de verdad: una ficha recién creada
  // o un resultado de búsqueda no traen plataformas.
  assertEquals(couldBeOnSteam([], "2009-11-09"), true);
  assertEquals(couldBeOnSteam(null, "2009-11-09"), true);
  assertEquals(couldBeOnSteam(undefined, "2009-11-09"), true);
});

Deno.test("gameRow escribe el appid aunque el juego sea de consola", () => {
  // Maui Mallard in Cold Shadow: se vende en Steam (987410) y en IGDB es un
  // juego de Super Nintendo del 96, porque las reediciones cuelgan de la ficha
  // ORIGINAL. Filtrar el appid por las plataformas —que es lo que esto hacía
  // durante unas horas— le borra el puente a los clásicos reeditados.
  const snes = gameRow({
    id: 8448,
    name: "Maui Mallard in Cold Shadow",
    platforms: [{ id: 19, name: "Super Nintendo Entertainment System" }],
    release_dates: [{ platform: 19, date: 849139200, date_format: { id: 0 } }],
    external_games: [{ category: 1, uid: "987410" }],
  });
  assertEquals(snes.steam_appid, 987_410);
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
    { platform: 130, y: 2027, m: 3, d: 12, date_format: DAY },
    { platform: 48, y: 2027, date_format: Q4 },
  ],
  involved_companies: [{ developer: true, company: { name: "Team Cherry" } }],
  total_rating: 91.2,
  total_rating_count: 40,
  hypes: 1200,
  external_games: [{ category: 1, uid: "1030300" }],
};

Deno.test("gameRow arma la fila que espera 0071", () => {
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

Deno.test("la fila de búsqueda lleva SIEMPRE las mismas claves", () => {
  // El upsert va en lote y PostgREST usa una sola lista de columnas con la
  // unión de las claves: la fila que omite una recibe un NULL explícito, no el
  // default. Con `platforms` NOT NULL eso reventaba la búsqueda entera en
  // cuanto un resultado no traía plataformas — "mario kart" iba y "mari" no.
  const completo = gameSearchRow({
    id: 1, name: "Con todo", summary: "algo",
    cover: { image_id: "co1" }, platforms: [{ id: 48, name: "PlayStation 5" }],
    total_rating: 80, total_rating_count: 5, hypes: 1,
  });
  const pelado = gameSearchRow({ id: 2, name: "Sin nada" });

  assertEquals(Object.keys(completo).sort(), Object.keys(pelado).sort());
  // Y los valores del pelado son los honestos, no ausencias.
  assertEquals(pelado.platforms, []);
  assertEquals(pelado.overview, null);
  assertEquals(pelado.poster_path, null);
  assertEquals(pelado.vote_average, null);
  assertEquals(pelado.popularity, 0);
});

Deno.test("sin tiempos de IGDB la columna no viaja en el upsert", () => {
  assertEquals("beat_seconds" in gameRow(DETAIL, null), false);
});

/* ─────────────────── La ficha ampliada del juego (0086) ─────────────────── */

Deno.test("vídeos: el de lanzamiento va primero, aunque IGDB lo mande el sexto", () => {
  // El orden del payload es el de subida, así que el teaser del anuncio —de
  // años antes— sale primero. Es exactamente el vídeo que NO hay que pintar.
  const out = videosRecortados([
    { name: "Announcement Trailer", video_id: "a" },
    { name: "Dev Diary", video_id: "b" },
    { name: "Cinematic Trailer", video_id: "c" },
    { name: "Launch Trailer", video_id: "d" },
  ]);
  assertEquals(out?.[0], { name: "Launch Trailer", video_id: "d" });
});

Deno.test("vídeos: gameplay por delante de un tráiler cualquiera", () => {
  const out = videosRecortados([
    { name: "Cinematic Trailer", video_id: "a" },
    { name: "Gameplay Overview", video_id: "b" },
  ]);
  assertEquals(out?.map((v) => v.video_id), ["b", "a"]);
});

Deno.test("vídeos: dentro del mismo rango manda el orden de IGDB", () => {
  // Ordenación estable: entre dos de lanzamiento gana el que se subió antes,
  // que es el del lanzamiento de verdad y no el del port de tres años después.
  const out = videosRecortados([
    { name: "Launch Trailer", video_id: "primero" },
    { name: "Switch Launch Trailer", video_id: "segundo" },
  ]);
  assertEquals(out?.map((v) => v.video_id), ["primero", "segundo"]);
});

Deno.test("vídeos: se descarta el que no trae id, y se cortan en cuatro", () => {
  const muchos = Array.from({ length: 9 }, (_, i) => ({ name: "Trailer", video_id: `v${i}` }));
  assertEquals(videosRecortados(muchos)?.length, 4);
  assertEquals(videosRecortados([{ name: "Sin id" }]), null);
  assertEquals(videosRecortados([]), null);
});

Deno.test("vídeos: sin nombre se le pone uno, no se descarta", () => {
  const out = videosRecortados([{ video_id: "x" }]);
  assertEquals(out, [{ name: "Trailer", video_id: "x" }]);
});

Deno.test("capturas: solo hashes, ocho como mucho", () => {
  const muchas = Array.from({ length: 16 }, (_, i) => ({ image_id: `sc${i}` }));
  assertEquals(capturasRecortadas(muchas)?.length, 8);
  assertEquals(capturasRecortadas(muchas)?.[0], "sc0");
  assertEquals(capturasRecortadas([{ url: "//sin-hash" }]), null);
  assertEquals(capturasRecortadas(null), null);
});

Deno.test("edad: se resuelven los dos enums, y se guardan todas", () => {
  // Los siete organismos de Baldur's Gate 3, tal cual los devuelve la API.
  const out = edades([
    { organization: 2, rating_category: 12 },
    { organization: 1, rating_category: 6 },
    { organization: 3, rating_category: 17 },
  ]);
  assertEquals(out, [
    { org: "PEGI", rating: "18" },
    { org: "ESRB", rating: "M" },
    { org: "CERO", rating: "Z" },
  ]);
});

Deno.test("edad: media fila no se pinta, así que no se guarda", () => {
  assertEquals(edades([{ organization: 2 }, { rating_category: 12 }, { organization: 99, rating_category: 12 }]), null);
});

Deno.test("web oficial: gana la de confianza sobre la que no lo es", () => {
  const url = webOficial([
    { type: 13, url: "https://store.steampowered.com/app/1", trusted: true },
    { type: 1, url: "https://dominio-caducado.example", trusted: false },
    { type: 1, url: "https://oficial.example", trusted: true },
  ]);
  assertEquals(url, "https://oficial.example");
});

Deno.test("web oficial: sin ninguna de confianza vale la primera oficial", () => {
  assertEquals(webOficial([{ type: 1, url: "https://a.example" }]), "https://a.example");
  assertEquals(webOficial([{ type: 13, url: "https://steam.example" }]), null);
  assertEquals(webOficial(null), null);
});

Deno.test("Steam: el porcentaje se calcula, no se copia el review_score", () => {
  // Los números reales de Baldur's Gate 3 el 27-ago-2026.
  assertEquals(steamReviews({ total_positive: 827336, total_reviews: 854808 }), { percent: 97, count: 854808 });
});

Deno.test("Steam: sin reseñas no hay porcentaje, y no se divide entre cero", () => {
  assertEquals(steamReviews({ total_positive: 0, total_reviews: 0 }), null);
  assertEquals(steamReviews({}), null);
  assertEquals(steamReviews(null), null);
});

Deno.test("Metacritic: solo 0-100", () => {
  assertEquals(metacritic({ metacritic: { score: 96 } }), 96);
  assertEquals(metacritic({ metacritic: { score: 0 } }), 0);
  assertEquals(metacritic({ metacritic: { score: 120 } }), null);
  assertEquals(metacritic({ metacritic: { score: "96" } }), null);
  assertEquals(metacritic({}), null);
});
