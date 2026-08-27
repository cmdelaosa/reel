// Pruebas del recorte de vídeos de una película. Las corre el job `edge` del CI
// (`deno test`).
//
// Lo que aquí se protege no es el orden por el orden: es que el PRIMERO de la
// lista sea el vídeo que la ficha va a poner, porque la ficha coge `videos[0]`
// sin mirar. Un clip de detrás de las cámaras en esa posición es un botón de
// play que enseña otra cosa.
import { assertEquals } from "jsr:@std/assert@1";
import { videosDeTmdb } from "./videos.ts";

const v = (
  key: string,
  { site = "YouTube", type = "Trailer", official = true, name = key } = {},
) => ({ key, site, type, official, name });

Deno.test("sin vídeos devuelve null, no una lista vacía", () => {
  assertEquals(videosDeTmdb(undefined), null);
  assertEquals(videosDeTmdb({}), null);
  assertEquals(videosDeTmdb({ results: [] }), null);
});

Deno.test("solo YouTube: lo de Vimeo no se guarda", () => {
  const out = videosDeTmdb({ results: [v("vimeo", { site: "Vimeo" }), v("yt")] });
  assertEquals(out?.map((x) => x.video_id), ["yt"]);
});

Deno.test("solo tráileres y teasers", () => {
  const out = videosDeTmdb({
    results: [
      v("clip", { type: "Clip" }),
      v("bts", { type: "Behind the Scenes" }),
      v("featurette", { type: "Featurette" }),
      v("teaser", { type: "Teaser" }),
      v("trailer", { type: "Trailer" }),
    ],
  });
  assertEquals(out?.map((x) => x.video_id), ["trailer", "teaser"]);
});

Deno.test("lo oficial manda sobre el tipo", () => {
  // Un tráiler NO oficial contra un teaser oficial: gana el oficial, porque lo
  // de fuera suele ser un montaje de un canal cualquiera.
  const out = videosDeTmdb({
    results: [
      v("trailer-de-fuera", { type: "Trailer", official: false }),
      v("teaser-oficial", { type: "Teaser", official: true }),
    ],
  });
  assertEquals(out?.[0].video_id, "teaser-oficial");
});

Deno.test("entre dos oficiales, el tráiler antes que el teaser", () => {
  const out = videosDeTmdb({
    results: [v("teaser", { type: "Teaser" }), v("trailer", { type: "Trailer" })],
  });
  assertEquals(out?.[0].video_id, "trailer");
});

Deno.test("a igual rango se respeta el orden de TMDB", () => {
  const out = videosDeTmdb({ results: [v("primero"), v("segundo"), v("tercero")] });
  assertEquals(out?.map((x) => x.video_id), ["primero", "segundo", "tercero"]);
});

Deno.test("como mucho cuatro", () => {
  const out = videosDeTmdb({ results: ["a", "b", "c", "d", "e", "f"].map((k) => v(k)) });
  assertEquals(out?.length, 4);
});

Deno.test("una fila sin key no entra, y sin nombre se llama Trailer", () => {
  const out = videosDeTmdb({
    results: [
      { site: "YouTube", type: "Trailer", official: true, name: "sin key" },
      { key: "abc", site: "YouTube", type: "Trailer", official: true },
    ],
  });
  assertEquals(out, [{ name: "Trailer", video_id: "abc" }]);
});
