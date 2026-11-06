// La traducción de la numeración de TMDB a la de un grupo de episodios. El caso
// es Lupin tal cual lo da TMDB (grupo «Parts», 6074e65418864b00439afa4f): tres
// temporadas en TMDB —10, 7 y 8 episodios— y cuatro partes en el grupo.
import { assertEquals } from "jsr:@std/assert@1";
import { detalleAgrupado, fuentesDe, leerGrupo, renumerar, temporadaAgrupada, temporadaParaGuardar } from "./grupo-episodios.ts";

const ep = (s: number, e: number, order: number) => ({ season_number: s, episode_number: e, order, air_date: `202${s}-01-0${(e % 9) + 1}` });
const rango = (s: number, desde: number, hasta: number) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => ep(s, desde + i, i));

const LUPIN = {
  groups: [
    { order: 1, name: "Part 1", episodes: rango(1, 1, 5) },
    { order: 2, name: "Part 2", episodes: rango(1, 6, 10) },
    { order: 3, name: "Part 3", episodes: rango(2, 1, 7) },
    // Desordenados a propósito: manda `order`, no la posición en la lista.
    { order: 4, name: "Part 4", episodes: rango(3, 1, 8).reverse() },
  ],
};
const g = leerGrupo(LUPIN);

Deno.test("cada parte es una temporada, numerada desde 1", () => {
  assertEquals(g.temporadas.map((t) => [t.number, t.name, t.episode_count]), [
    [1, "Part 1", 5], [2, "Part 2", 5], [3, "Part 3", 7], [4, "Part 4", 8],
  ]);
  assertEquals(renumerar(g, 1, 6), { season: 2, episode: 1 });
  assertEquals(renumerar(g, 2, 7), { season: 3, episode: 7 });
  assertEquals(renumerar(g, 3, 1), { season: 4, episode: 1 });
  assertEquals(renumerar(g, 3, 8), { season: 4, episode: 8 });
});

Deno.test("una temporada nueva de TMDB que el grupo aún no lista va detrás", () => {
  // La Parte 5 llega como T4 de TMDB antes de que nadie la añada al grupo: tiene
  // que aparecer como temporada 5, no perderse ni chocar con la Parte 4.
  assertEquals(renumerar(g, 4, 2), { season: 5, episode: 2 });
  assertEquals(fuentesDe(g, 5), [4]);
});

Deno.test("un episodio de una temporada cubierta que el grupo no lista no tiene sitio", () => {
  // Darle su número de TMDB (T1·E11) lo dejaría en la Parte 1, y un número
  // inventado podría pisar el de otro.
  assertEquals(renumerar(g, 1, 11), null);
});

Deno.test("los especiales siguen en la temporada 0 si el grupo no tiene la suya", () => {
  assertEquals(renumerar(g, 0, 3), { season: 0, episode: 3 });
  const conEspeciales = leerGrupo({ groups: [{ order: 0, name: "Specials", episodes: [ep(1, 1, 0)] }] });
  assertEquals(renumerar(conEspeciales, 0, 3), null);
});

Deno.test("de qué temporadas de TMDB sale cada parte", () => {
  assertEquals(fuentesDe(g, 1), [1]);
  assertEquals(fuentesDe(g, 2), [1]);
  assertEquals(fuentesDe(g, 4), [3]);
});

Deno.test("el detalle cuenta cuatro temporadas y el último emitido en su parte", () => {
  const d = detalleAgrupado({
    seasons: [
      { id: 9, season_number: 0, name: "Specials", episode_count: 2 },
      { id: 1, season_number: 1, episode_count: 10 },
      { id: 2, season_number: 2, episode_count: 7 },
      { id: 3, season_number: 3, episode_count: 8 },
    ],
    last_episode_to_air: { season_number: 3, episode_number: 8, name: "x" },
    next_episode_to_air: null,
  }, g);
  assertEquals(d.seasons.map((s: { season_number: number; id: number | null }) => [s.season_number, s.id]), [
    [0, 9], [1, null], [2, null], [3, null], [4, null],
  ]);
  assertEquals(d.last_episode_to_air, { season_number: 4, episode_number: 8, name: "x" });
  assertEquals(d.next_episode_to_air, null);
});

Deno.test("la Parte 2 se monta con la segunda mitad de la T1 de TMDB", () => {
  const t1 = { id: 1, episodes: rango(1, 1, 10).map((e) => ({ ...e, name: `T1E${e.episode_number}` })) };
  const parte2 = temporadaAgrupada(g, 2, [t1]);
  assertEquals(parte2.season_number, 2);
  assertEquals(parte2.name, "Part 2");
  assertEquals(parte2.episode_count, 5);
  assertEquals(
    parte2.episodes.map((e: { season_number: number; episode_number: number; name: string; par_tmdb: string }) =>
      [e.season_number, e.episode_number, e.name, e.par_tmdb]),
    [[2, 1, "T1E6", "1:6"], [2, 2, "T1E7", "1:7"], [2, 3, "T1E8", "1:8"], [2, 4, "T1E9", "1:9"], [2, 5, "T1E10", "1:10"]],
  );
});

Deno.test("sin grupo se piden las dos de siempre y pasan tal cual", async () => {
  const pedidas: string[] = [];
  const pedir = (p: string) => (pedidas.push(p), Promise.resolve({ path: p }));
  const [canonica, espanola] = await temporadaParaGuardar(pedir, 96677, null, 2);
  assertEquals(pedidas, ["/tv/96677/season/2", "/tv/96677/season/2?language=es-ES"]);
  assertEquals(canonica, { path: "/tv/96677/season/2" });
  assertEquals(espanola, { path: "/tv/96677/season/2?language=es-ES" });
});

Deno.test("con grupo, si la española falla, la temporada sale igual sin ella", async () => {
  const pedir = (p: string) =>
    p.includes("es-ES") ? Promise.reject(new Error("TMDB 500")) : Promise.resolve({ id: 1, episodes: rango(1, 1, 10) });
  const [canonica, espanola] = await temporadaParaGuardar(pedir, 96677, g, 1);
  assertEquals(canonica.episodes.length, 5);
  assertEquals(espanola, null);
});
