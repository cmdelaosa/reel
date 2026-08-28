import { describe, expect, it } from "vitest";
import { platformFamily, platformModel, playPlatform } from "@/domain/platformModel";
import { PLATFORM_MARKS } from "@/ui/icons/platformMarks";

/* Los nombres son los DE IGDB, copiados tal cual: son los que llegan a
   `titles.platforms` y los únicos que este mapa tiene que reconocer. */
describe("platformModel — el aparato exacto", () => {
  it("distingue las generaciones de PlayStation", () => {
    expect(platformModel("PlayStation 5").mark).toBe("ps5");
    expect(platformModel("PlayStation 4").mark).toBe("ps4");
    expect(platformModel("PlayStation 3").mark).toBe("ps3");
    expect(platformModel("PlayStation 2").mark).toBe("ps2");
    expect(platformModel("PlayStation Vita").mark).toBe("psvita");
    expect(platformModel("PlayStation Portable").label).toBe("PSP");
  });

  it("Xbox comparte esfera, así que la generación la dice el nombre", () => {
    expect(platformModel("Xbox Series X|S").mark).toBe("xbox");
    expect(platformModel("Xbox 360").mark).toBe("xbox");
    // Sin `label` propia: se queda con el nombre que venga.
    expect(platformModel("Xbox Series X|S").label).toBe("Xbox Series X|S");
    expect(platformModel("Xbox 360").label).toBe("Xbox 360");
  });

  it("cada Nintendo con la suya", () => {
    expect(platformModel("Nintendo Entertainment System").mark).toBe("nes");
    expect(platformModel("Super Nintendo Entertainment System").mark).toBe("snes");
    expect(platformModel("Nintendo 64").mark).toBe("n64");
    expect(platformModel("Nintendo GameCube").mark).toBe("gamecube");
    expect(platformModel("Wii").mark).toBe("wii");
    expect(platformModel("Wii U").mark).toBe("wiiu");
    expect(platformModel("Nintendo Switch").mark).toBe("switch");
    expect(platformModel("Nintendo Switch 2").mark).toBe("switch2");
    expect(platformModel("Game Boy Color").mark).toBe("gbc");
    expect(platformModel("Game Boy Advance").mark).toBe("gba");
    expect(platformModel("Virtual Boy").mark).toBe("virtualboy");
    expect(platformModel("Nintendo DS").mark).toBe("ds");
    expect(platformModel("Nintendo 3DS").mark).toBe("n3ds");
    expect(platformModel("New Nintendo 3DS").mark).toBe("n3ds");
  });

  /* Estas cuatro son las que ata el ORDEN de la lista: cada nombre contiene
     otro nombre más corto, y gana la primera regla que casa. Si alguien
     reordena, se rompe aquí y no en la ficha de un juego de 1992. */
  it("el nombre largo gana al nombre corto que lleva dentro", () => {
    expect(platformModel("Nintendo Switch 2").mark).toBe("switch2");
    expect(platformModel("Wii U").mark).toBe("wiiu");
    expect(platformModel("Super Nintendo Entertainment System").mark).toBe("snes");
    expect(platformModel("Steam Deck (Linux)").mark).toBe("steamdeck");
  });

  it("la Game Boy a secas no tiene SVG libre y cae en el de Nintendo", () => {
    expect(platformModel("Game Boy").mark).toBe("nintendo");
    expect(platformModel("Game Boy").label).toBe("Game Boy");
  });

  it("el ordenador, separado en la ficha", () => {
    expect(platformModel("PC (Microsoft Windows)").label).toBe("Windows");
    expect(platformModel("Mac").mark).toBe("mac");
    expect(platformModel("Linux").mark).toBe("linux");
    expect(platformModel("Steam Deck").mark).toBe("steamdeck");
  });

  it("Web y Arcade no son marca de nadie: pictograma genérico", () => {
    expect(platformModel("Web browser").mark).toBeNull();
    expect(platformModel("Web browser").label).toBe("Web");
    expect(platformModel("Arcade").mark).toBeNull();
  });

  it("lo que no reconoce sale con su nombre y el mando genérico", () => {
    expect(platformModel("Sega Mega Drive/Genesis")).toEqual({
      id: "other", label: "Sega Mega Drive/Genesis", mark: null, family: "other",
    });
    expect(platformModel("Atari 2600").mark).toBeNull();
    expect(platformModel("").mark).toBeNull();
  });

  /* La razón de ser del mapa por patrón: la consola que salga mañana cae en su
     familia sin tocar el fichero, con su nombre escrito y la marca de la casa. */
  it("una consola que aún no existe cae en su familia", () => {
    expect(platformModel("PlayStation 7")).toMatchObject({ mark: "ps1", label: "PlayStation 7", family: "playstation" });
    expect(platformModel("Xbox Infinite")).toMatchObject({ mark: "xbox", label: "Xbox Infinite", family: "xbox" });
  });

  it("toda marca que nombra una regla existe de verdad", () => {
    for (const nombre of CATALOGO) {
      const { mark } = platformModel(nombre);
      if (mark !== null) expect(PLATFORM_MARKS).toHaveProperty(mark);
    }
  });
});

describe("playPlatform — lo que se elige en «en cuál lo juegas»", () => {
  it("todo el ordenador es una sola PC", () => {
    for (const n of ["PC (Microsoft Windows)", "Mac", "Linux", "SteamOS", "Steam Deck", "DOS"]) {
      expect(playPlatform(n)).toMatchObject({ id: "pc", label: "PC", mark: "steam" });
    }
  });

  it("el móvil NO se agrupa: iOS y Android son dos respuestas distintas", () => {
    expect(playPlatform("iOS").label).toBe("iOS");
    expect(playPlatform("Android").label).toBe("Android");
  });

  it("las consolas siguen diciendo el modelo", () => {
    expect(playPlatform("PlayStation 5").label).toBe("PlayStation 5");
    expect(playPlatform("Nintendo Switch").label).toBe("Nintendo Switch");
    expect(playPlatform("Game Boy Advance").label).toBe("Game Boy Advance");
  });

  it("el arcade se queda", () => {
    expect(playPlatform("Arcade").label).toBe("Arcade");
  });
});

/* Un nombre de IGDB por cada regla, más los raros que han roto algo alguna
   vez. Lo recorren los dos tests de abajo. */
const CATALOGO = [
  "PC (Microsoft Windows)", "Mac", "Linux", "SteamOS", "Steam Deck", "Steam Deck (Linux)", "DOS",
  "PlayStation", "PlayStation 2", "PlayStation 3", "PlayStation 4", "PlayStation 5",
  "PlayStation Portable", "PlayStation Vita", "PlayStation VR",
  "Xbox", "Xbox 360", "Xbox One", "Xbox Series X|S",
  "Nintendo Entertainment System", "Family Computer", "Super Nintendo Entertainment System",
  "Super Famicom", "Nintendo 64", "Nintendo 64DD", "Nintendo GameCube", "Wii", "Wii U",
  "Nintendo Switch", "Nintendo Switch 2", "Game Boy", "Game Boy Color", "Game Boy Advance",
  "Virtual Boy", "Nintendo DS", "Nintendo DSi", "Nintendo 3DS", "New Nintendo 3DS",
  "iOS", "iPad", "Android", "Web browser", "Arcade", "Neo Geo MVS",
  "Sega Mega Drive/Genesis", "Atari 2600",
];

/* ── El test que evita una migración ───────────────────────────────────────
   `library_entries.played_platform` guardaba el nombre de IGDB y desde ahora
   guarda la etiqueta. Las fichas ya puestas siguen valiendo SOLO si cada
   etiqueta se reconoce a sí misma: «PC (Microsoft Windows)» da «PC», y «PC»
   tiene que volver a dar «PC». El día que una regla deje de cumplirlo, las
   entradas viejas se quedan sin logotipo y sin nadie avisando. */
describe("las etiquetas se reconocen a sí mismas", () => {
  it("pasar una etiqueta por playPlatform devuelve la misma", () => {
    for (const nombre of CATALOGO) {
      const primera = playPlatform(nombre);
      const segunda = playPlatform(primera.label);
      expect(segunda, `«${nombre}» → «${primera.label}» → «${segunda.label}»`).toEqual(primera);
    }
  });

  it("y lo mismo con el modelo de la ficha", () => {
    for (const nombre of CATALOGO) {
      const primera = platformModel(nombre);
      expect(platformModel(primera.label), `«${nombre}» → «${primera.label}»`).toEqual(primera);
    }
  });
});

describe("platformFamily — solo decide el color", () => {
  it("sigue clasificando como antes", () => {
    expect(platformFamily("PlayStation 5")).toBe("playstation");
    expect(platformFamily("Xbox 360")).toBe("xbox");
    expect(platformFamily("Game Boy Advance")).toBe("nintendo");
    expect(platformFamily("PC (Microsoft Windows)")).toBe("windows");
    expect(platformFamily("DOS")).toBe("windows");
    expect(platformFamily("Mac")).toBe("apple");
    expect(platformFamily("iOS")).toBe("apple");
    expect(platformFamily("SteamOS")).toBe("steam");
    expect(platformFamily("Steam Deck (Linux)")).toBe("steam");
    expect(platformFamily("Linux")).toBe("linux");
    expect(platformFamily("Android")).toBe("android");
    expect(platformFamily("Web browser")).toBe("web");
    expect(platformFamily("Arcade")).toBe("arcade");
    expect(platformFamily("Sega Mega Drive/Genesis")).toBe("other");
    expect(platformFamily("")).toBe("other");
  });
});
