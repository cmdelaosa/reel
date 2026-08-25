import { describe, expect, it } from "vitest";
import { heroArt, thumbArt } from "@/lib/artwork";

/* Lo que se prueba aquí es la equivalencia entre las dos fuentes, que es lo
   único que este módulo decide. El fallo que lo trajo no fue un tamaño mal
   elegido: fue que la misma regla estaba escrita tres veces y dos copias se
   quedaron con el retrato. */

describe("heroArt", () => {
  it("prefiere el apaisado en los tres medios", () => {
    expect(heroArt("tv", "/back.jpg", "/post.jpg")).toContain("/w1280/back.jpg");
    expect(heroArt("movie", "/back.jpg", "/post.jpg")).toContain("/w1280/back.jpg");
    expect(heroArt("game", "ar2xyz", "co1abc")).toContain("t_1080p/ar2xyz.jpg");
  });

  it("cae al retrato cuando no hay apaisado, y con SU tamaño", () => {
    // w780 y no w1280: la escalera de pósters de TMDB no tiene ese peldaño y
    // devolvería un 404 — un banner en blanco en vez de uno recortado.
    expect(heroArt("movie", null, "/post.jpg")).toContain("/w780/post.jpg");
    expect(heroArt("tv", null, "/post.jpg")).toContain("/w780/post.jpg");
    // cover_big y no 1080p: no hay más píxeles que traer en una carátula.
    expect(heroArt("game", null, "co1abc")).toContain("t_cover_big/co1abc.jpg");
  });

  it("un juego nunca pide su imagen a TMDB", () => {
    // `poster_path` de un juego es un HASH de IGDB, no una ruta: pasárselo a
    // tmdbImg da una URL bien formada que responde 404 sin quejarse.
    const url = heroArt("game", "ar2xyz", "co1abc")!;
    expect(url).toContain("images.igdb.com");
    expect(url).not.toContain("image.tmdb.org");
  });

  it("sin ninguna de las dos no inventa una URL", () => {
    expect(heroArt("tv", null, null)).toBeUndefined();
    expect(heroArt("game", null, null)).toBeUndefined();
    expect(heroArt("game", undefined, undefined)).toBeUndefined();
  });
});

describe("thumbArt", () => {
  it("cada medio a su fuente", () => {
    expect(thumbArt("game", "co1abc")).toContain("images.igdb.com");
    expect(thumbArt("tv", "/post.jpg")).toContain("image.tmdb.org");
  });
});
