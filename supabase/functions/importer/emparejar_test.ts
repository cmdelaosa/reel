// El emparejamiento de visionados de TV Time con episodios de TMDB. TV Time
// numera como TheTVDB, y TheTVDB y TMDB no siempre coinciden: lo que aquí se
// prueba es qué pasa cuando no casan — que es como «White Christmas» se quedó
// sin marcar (S00E01 en TheTVDB, S02E04 en TMDB).
import { assertEquals } from "jsr:@std/assert@1";
import { matchWatches } from "../../../scripts/tvtime-import/match.ts";

const byPair = new Map([["2:3", "waldo"], ["2:4", "white-christmas"]]);
const tmdb = new Map([["5057304", "2:4"], ["4418486", "2:3"], ["6959083", "0:2"]]);
const lookup = (id: string) => Promise.resolve(tmdb.get(id) ?? null);

Deno.test("el número que casa no pregunta a TMDB", async () => {
  let asked = 0;
  const { watchedAt, unmatched } = await matchWatches(
    [{ season: 2, episode: 3, watchedAt: "2020-04-17T11:53:06Z", tvdbEpisodeId: "4418486" }],
    byPair,
    (id) => (asked++, lookup(id)),
  );
  assertEquals([...watchedAt], [["waldo", "2020-04-17T11:53:06Z"]]);
  assertEquals(unmatched, 0);
  assertEquals(asked, 0);
});

Deno.test("un especial de TheTVDB que TMDB numera dentro de una temporada se marca", async () => {
  const { watchedAt, unmatched } = await matchWatches(
    [{ season: 0, episode: 1, watchedAt: "2020-04-17T11:53:07Z", tvdbEpisodeId: "5057304" }],
    byPair,
    lookup,
  );
  assertEquals([...watchedAt], [["white-christmas", "2020-04-17T11:53:07Z"]]);
  assertEquals(unmatched, 0);
});

Deno.test("lo que TMDB deja como especial, o no conoce, cuenta como sin emparejar", async () => {
  const { watchedAt, unmatched } = await matchWatches(
    [
      { season: 0, episode: 2, watchedAt: "2019-06-17T10:44:38Z", tvdbEpisodeId: "6959083" },
      { season: 9, episode: 9, watchedAt: "2019-06-17T10:44:38Z", tvdbEpisodeId: "1" },
      { season: 9, episode: 8, watchedAt: "2019-06-17T10:44:38Z" },
    ],
    byPair,
    lookup,
  );
  assertEquals(watchedAt.size, 0);
  assertEquals(unmatched, 3);
});

Deno.test("dos visionados que caen en el mismo episodio salen como uno, el más antiguo", async () => {
  // Sin esto viajan los dos en el mismo upsert y Postgres rechaza el lote
  // entero: la serie se quedaría sin NINGÚN visionado.
  const later = { season: 2, episode: 4, watchedAt: "2021-01-01T00:00:00Z", tvdbEpisodeId: "x" };
  const earlier = { season: 0, episode: 1, watchedAt: "2020-04-17T11:53:07Z", tvdbEpisodeId: "5057304" };
  // En los dos órdenes: «gana el último» acertaría en uno por casualidad.
  for (const watches of [[later, earlier], [earlier, later]]) {
    const { watchedAt } = await matchWatches(watches, byPair, lookup);
    assertEquals([...watchedAt], [["white-christmas", "2020-04-17T11:53:07Z"]]);
  }
});
