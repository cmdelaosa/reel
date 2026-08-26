/* De qué FAMILIA es una plataforma de IGDB. Puro, con tests al lado
   (platformFamily.test.ts).

   Existe porque la ficha de un juego enseña las plataformas como logotipos
   (ui/PlatformLogo) y los logotipos son de marcas, no de modelos: no hay un
   dibujo distinto de "PlayStation 4" y de "PlayStation 5", hay uno de
   PlayStation. El modelo exacto y su fecha los dice el `title` al pasar por
   encima, que es donde caben sin ocupar sitio.

   IGDB nombra unas doscientas plataformas y la lista crece con cada consola.
   Por eso esto es un MAPA DE FAMILIAS por patrón y no una tabla de nombres:
   "PlayStation 6" cae en su sitio el día que exista, sin tocar nada. Lo que no
   reconozca cae en 'other', que tiene su propio dibujo genérico — nunca un
   hueco.

   El orden de las reglas importa y por eso son una lista y no un objeto: "PC
   (Microsoft Windows)" contiene "PC" y "Windows", y "Nintendo Switch" contiene
   "Switch"; gana la primera que casa. */

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

const RULES: { re: RegExp; family: PlatformFamily }[] = [
  { re: /playstation|^ps[1-5x]?\b|^psp\b|\bps vita\b|\bpsvr\b/i, family: "playstation" },
  { re: /xbox/i, family: "xbox" },
  {
    re: /nintendo|switch|\bwii\b|game ?boy|gamecube|famicom|\bnes\b|\bsnes\b|\bn64\b|virtual boy|\b3ds\b|\bds\b/i,
    family: "nintendo",
  },
  // Antes que Windows y que Linux, y no por gusto: una Steam Deck es las dos
  // cosas —SteamOS es Linux— y lo que uno reconoce en ella es Steam. Hoy IGDB
  // la llama "Steam Deck" a secas y el orden no se nota; el día que la llame
  // "Steam Deck (Linux)", que es como la nombra media internet, sí.
  { re: /steam ?(deck|os|machine)/i, family: "steam" },
  { re: /windows|^pc\b|\bdos\b/i, family: "windows" },
  // Apple entera con un solo dibujo —la manzana— porque eso es lo que hay: no
  // existe un logotipo de "Mac" distinto del de "iOS". La línea de abajo los
  // distingue al pasar por encima.
  { re: /\bmac\b|macos|os x|\bios\b|ipad|iphone|apple|tvos/i, family: "apple" },
  { re: /android/i, family: "android" },
  { re: /linux/i, family: "linux" },
  { re: /browser|\bweb\b/i, family: "web" },
  { re: /arcade|neo geo mvs/i, family: "arcade" },
];

export function platformFamily(name: string): PlatformFamily {
  return RULES.find((r) => r.re.test(name))?.family ?? "other";
}
