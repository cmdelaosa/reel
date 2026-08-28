/* De qué APARATO es una plataforma de IGDB. Puro, con tests al lado
   (platformModel.test.ts).

   Sustituye al mapa de familias de 0088, que daba un solo dibujo por marca —
   uno de PlayStation para las cinco, uno de Nintendo para catorce consolas. La
   razón de aquello era que «no existe un logotipo de PlayStation 4 distinto del
   de PlayStation 5». Existe: lo que no existía era el sitio donde ponerlo, una
   baldosa cuadrada de 30 px donde un wordmark de siete a uno no cabe. Con la
   pastilla de ancho libre (ui/PlatformLogo) sí cabe, y entonces la ficha puede
   decir el aparato exacto en vez de la marca.

   ── Dos niveles, y por qué ────────────────────────────────────────────────
   `platformModel` es el DETALLE: sirve la ficha del juego, donde saber que algo
   está en Mac y no solo en Windows es justo lo que buscas antes de comprarlo.

   `playPlatform` es lo que se ELIGE en «en cuál lo juegas», y ahí el ordenador
   entero es «PC»: Windows, Mac, Linux, SteamOS y la Steam Deck son la misma
   respuesta a «dónde lo tengo». Lo demás no se agrupa — una PS4 no es una PS5 y
   una Switch no es una Game Boy.

   ── Las etiquetas son idempotentes, y eso evita una migración ─────────────
   `library_entries.played_platform` guarda hoy el nombre de IGDB tal cual («PC
   (Microsoft Windows)»). Desde ahora guarda la ETIQUETA («PC»), y las dos pasan
   por aquí y salen en el mismo sitio: la regla que reconoce «PC (Microsoft
   Windows)» reconoce también «PC». Un test recorre el catálogo entero
   comprobándolo, porque el día que una etiqueta deje de reconocerse a sí misma
   las fichas ya guardadas se quedan sin logotipo y sin nadie avisando.

   ── El orden de las reglas es el contrato ─────────────────────────────────
   Gana la primera que casa, y por eso son una lista: «Super Nintendo
   Entertainment System» contiene «Nintendo Entertainment System», «Nintendo
   Switch 2» contiene «Nintendo Switch», y «Steam Deck (Linux)» contiene
   «Linux». Las reglas sin `label` se quedan con el nombre que venga: son las
   coladeras de cada familia, y son las que hacen que una PlayStation 7 salga
   con su marca y su nombre el día que exista, sin tocar este fichero. */

import type { MarkKey } from "@/ui/icons/platformMarks";

export type PlatformFamily =
  | "playstation"
  | "xbox"
  | "nintendo"
  | "windows"
  | "apple"
  | "android"
  | "linux"
  | "steam"
  | "web"
  | "arcade"
  | "other";

export type PlatformModel = {
  /** Clave estable del aparato. No se guarda en la base: es para el código. */
  id: string;
  /** El nombre exacto que se enseña. */
  label: string;
  /** La marca que se dibuja; `null` es el pictograma genérico de ui/PlatformLogo. */
  mark: MarkKey | null;
  family: PlatformFamily;
};

/** Lo que se ofrece en «en cuál lo juegas»: como el modelo, salvo el PC. */
export type PlayPlatform = PlatformModel;

type Regla = {
  re: RegExp;
  id: string;
  /** Sin `label`, se usa el nombre tal cual llegó. */
  label?: string;
  mark: MarkKey | null;
  family: PlatformFamily;
};

/* El ordenador entero, como UNA opción de «en cuál lo juegas». El símbolo es el
   de Steam y no la ventana de Windows a propósito: la ventana deja fuera a Mac
   y a Linux, y quien juega en ordenador reconoce antes la válvula. */
const PC: PlatformModel = { id: "pc", label: "PC", mark: "steam", family: "steam" };
const ES_PC = new Set(["windows", "mac", "linux", "steam", "steamdeck"]);

const RULES: Regla[] = [
  // ── PlayStation ──────────────────────────────────────────────────────────
  { re: /playstation 5|^ps5\b/i, id: "ps5", label: "PlayStation 5", mark: "ps5", family: "playstation" },
  { re: /playstation 4|^ps4\b/i, id: "ps4", label: "PlayStation 4", mark: "ps4", family: "playstation" },
  { re: /playstation 3|^ps3\b/i, id: "ps3", label: "PlayStation 3", mark: "ps3", family: "playstation" },
  { re: /playstation 2|^ps2\b/i, id: "ps2", label: "PlayStation 2", mark: "ps2", family: "playstation" },
  { re: /playstation portable|^psp\b/i, id: "psp", label: "PSP", mark: "psp", family: "playstation" },
  { re: /playstation vita|^ps ?vita\b/i, id: "psvita", label: "PS Vita", mark: "psvita", family: "playstation" },
  // La coladera de la familia: PSVR, PS one, y la que salga en 2030.
  { re: /playstation|^ps[1x]?\b|\bpsvr\b/i, id: "playstation", mark: "ps1", family: "playstation" },

  // ── Xbox ─────────────────────────────────────────────────────────────────
  // Una sola regla porque hay un solo dibujo: Microsoft usa la misma esfera
  // para las cuatro generaciones, así que la que se juega la dice el nombre.
  { re: /xbox/i, id: "xbox", mark: "xbox", family: "xbox" },

  // ── Nintendo ─────────────────────────────────────────────────────────────
  { re: /switch 2/i, id: "switch2", label: "Nintendo Switch 2", mark: "switch2", family: "nintendo" },
  { re: /nintendo switch|^switch\b/i, id: "switch", label: "Nintendo Switch", mark: "switch", family: "nintendo" },
  { re: /wii u/i, id: "wiiu", label: "Wii U", mark: "wiiu", family: "nintendo" },
  { re: /\bwii\b/i, id: "wii", label: "Wii", mark: "wii", family: "nintendo" },
  { re: /gamecube/i, id: "gamecube", label: "GameCube", mark: "gamecube", family: "nintendo" },
  { re: /nintendo 64|^n64\b/i, id: "n64", label: "Nintendo 64", mark: "n64", family: "nintendo" },
  { re: /super nintendo|super famicom|^snes\b/i, id: "snes", label: "Super Nintendo", mark: "snes", family: "nintendo" },
  { re: /nintendo entertainment system|famicom|family computer|^nes\b/i, id: "nes", label: "NES", mark: "nes", family: "nintendo" },
  { re: /virtual boy/i, id: "virtualboy", label: "Virtual Boy", mark: "virtualboy", family: "nintendo" },
  { re: /game boy advance|^gba\b/i, id: "gba", label: "Game Boy Advance", mark: "gba", family: "nintendo" },
  { re: /game boy color|^gbc\b/i, id: "gbc", label: "Game Boy Color", mark: "gbc", family: "nintendo" },
  // La Game Boy a secas no tiene SVG libre: cae en el wordmark de Nintendo, que
  // al menos es suyo. El nombre escrito al lado es el que dice cuál es.
  { re: /game boy/i, id: "gameboy", label: "Game Boy", mark: "nintendo", family: "nintendo" },
  { re: /nintendo 3ds|^3ds\b/i, id: "n3ds", label: "Nintendo 3DS", mark: "n3ds", family: "nintendo" },
  { re: /nintendo ds|^ds\b/i, id: "ds", label: "Nintendo DS", mark: "ds", family: "nintendo" },
  { re: /nintendo/i, id: "nintendo", mark: "nintendo", family: "nintendo" },

  // ── Ordenador ────────────────────────────────────────────────────────────
  // Antes que Windows y que Linux, y no por gusto: una Steam Deck es las dos
  // cosas —SteamOS es Linux— y lo que uno reconoce en ella es Steam.
  { re: /steam deck/i, id: "steamdeck", label: "Steam Deck", mark: "steamdeck", family: "steam" },
  { re: /steamos|steam machine/i, id: "steam", mark: "steam", family: "steam" },
  { re: /windows|^pc\b|\bdos\b/i, id: "windows", label: "Windows", mark: "windows", family: "windows" },
  { re: /\bios\b|ipados|ipad|iphone|tvos/i, id: "ios", label: "iOS", mark: "ios", family: "apple" },
  { re: /\bmac\b|macos|os x/i, id: "mac", label: "Mac", mark: "mac", family: "apple" },
  // La coladera de Apple: el Pippin, el Apple II. La manzana es suya y el
  // nombre que traiga IGDB es el que se lee.
  { re: /apple/i, id: "apple", mark: "mac", family: "apple" },
  { re: /android/i, id: "android", label: "Android", mark: "android", family: "android" },
  { re: /linux/i, id: "linux", label: "Linux", mark: "linux", family: "linux" },

  // ── Sin marca que copiar ─────────────────────────────────────────────────
  { re: /browser|\bweb\b/i, id: "web", label: "Web", mark: null, family: "web" },
  { re: /arcade|neo geo mvs/i, id: "arcade", label: "Arcade", mark: null, family: "arcade" },
];

/** El aparato exacto: lo que enseña la fila de plataformas de la ficha. */
export function platformModel(name: string): PlatformModel {
  const r = RULES.find((x) => x.re.test(name));
  if (!r) return { id: "other", label: name, mark: null, family: "other" };
  return { id: r.id, label: r.label ?? name, mark: r.mark, family: r.family };
}

/** Lo que se elige en «en cuál lo juegas». Igual que el modelo, salvo que todo
 *  el ordenador —Windows, Mac, Linux, SteamOS, Steam Deck— es una sola «PC». */
export function playPlatform(name: string): PlayPlatform {
  const m = platformModel(name);
  return ES_PC.has(m.id) ? PC : m;
}

/** La familia, que es lo único que decide el COLOR de la marca. */
export function platformFamily(name: string): PlatformFamily {
  return platformModel(name).family;
}
