import { Gamepad2, Globe, Joystick, Terminal } from "lucide-react";
import { platformFamily, type PlatformFamily } from "@/domain/platformFamily";
import { SteamIcon } from "@/ui/icons/SteamIcon";

/* La marca de una plataforma de videojuegos, en una baldosa.
 *
 * Es la hermana de ui/NetworkLogo para el tercer medio, y nace del mismo
 * problema con la respuesta contraria. Los logotipos de las cadenas los sirve
 * TMDB como imagen; los de las plataformas no los sirve nadie — IGDB tiene
 * `platform_logo`, pero son cientos de PNG en blanco y negro de tamaños
 * dispares, y traerlos costaría una columna nueva, un despliegue del proxy y
 * una ficha vieja enseñando huecos hasta que se refresque.
 *
 * Así que se dibujan aquí, y son POCOS a propósito: uno por familia
 * (domain/platformFamily), no uno por modelo. No existe un logotipo de
 * "PlayStation 5" distinto del de "PlayStation 4" — existe el de PlayStation.
 * El modelo exacto y su fecha los dice el `title` al pasar por encima.
 *
 * Los trazados son originales y geométricos: los cuatro botones del mando de
 * PlayStation, la equis de Xbox, los dos raíles de la Switch, los cuatro
 * paneles de Windows, la manzana, el robot. Lo único ajeno es el de Steam, que
 * ya vivía en ui/icons/SteamIcon (Simple Icons, CC0). Lo que no se reconoce cae
 * en un mando genérico de lucide — nunca en un hueco.
 *
 * El color es el de la marca y no el del tema: es la mitad de lo que hace que
 * se reconozca de un vistazo a 22 px. */

const TINT: Record<PlatformFamily, string> = {
  playstation: "#4f8fdb",
  xbox: "#4fbf4f",
  nintendo: "#f0464e",
  windows: "#3aa0ea",
  apple: "#d3d8de",
  android: "#3ddc84",
  linux: "#f0b429",
  steam: "#66c0f4",
  web: "#8ab4f8",
  arcade: "#e2a3ff",
  other: "#a8b1c2",
};

function Mark({ family, size }: { family: PlatformFamily; size: number }) {
  const svg = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (family) {
    /* Los cuatro botones del mando: triángulo, círculo, equis y cuadrado. Es
       lo que se dibuja en una servilleta cuando alguien dice PlayStation. */
    case "playstation":
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.6 15.1 8H8.9z" />
          <circle cx="18.4" cy="12" r="2.9" />
          <path d="M9.6 16.6l4.8 4.8M14.4 16.6l-4.8 4.8" />
          <rect x="2.7" y="9.1" width="5.8" height="5.8" rx="0.6" />
        </svg>
      );
    case "xbox":
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="9.2" />
          <path d="M7.4 6.2c2.2 1.5 3.8 3.2 4.6 4.4.8-1.2 2.4-2.9 4.6-4.4" />
          <path d="M7.4 17.8c2.2-1.5 3.8-3.2 4.6-4.4.8 1.2 2.4 2.9 4.6 4.4" />
        </svg>
      );
    /* La consola de sobremesa portátil, de frente: la pantalla y un Joy-Con a
       cada lado. Tres trazos, que es lo que sobrevive a 18 px — la primera
       versión rellenaba el raíl izquierdo y a ese tamaño se leía como una
       mancha con una letra al lado. */
    case "nintendo":
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
          <rect x="3.2" y="5" width="17.6" height="14" rx="3.2" />
          <path d="M8.6 5v14M15.4 5v14" />
        </svg>
      );
    case "windows":
      return (
        <svg {...svg} fill="currentColor">
          <path d="M3 5.4l7.6-1.05v7.2H3zM11.9 4.16L21 2.9v8.65h-9.1zM3 12.85h7.6v7.2L3 18.99zM11.9 12.85H21v8.65l-9.1-1.26z" />
        </svg>
      );
    case "apple":
      return (
        <svg {...svg} fill="currentColor">
          <path d="M16.4 12.5c0-2.2 1.7-3.3 1.8-3.4-1-1.5-2.5-1.7-3.1-1.7-1.3-.1-2.6.8-3.2.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.9-3.5 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.1 1.1 0 1.5-.7 2.8-.7s1.7.7 2.8.7c1.2 0 1.9-1 2.6-2.1.8-1.2 1.2-2.3 1.2-2.4 0 0-2.3-.9-2.4-3.3z" />
          <path d="M14.3 5.9c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z" />
        </svg>
      );
    case "android":
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M4.5 14.5a7.5 7.5 0 0 1 15 0z" fill="currentColor" stroke="none" />
          <path d="M4.5 14.5h15" />
          <path d="M7.2 7.4 5.9 5.3M16.8 7.4l1.3-2.1" />
          <circle cx="9.4" cy="11" r=".95" fill="var(--surface)" stroke="none" />
          <circle cx="14.6" cy="11" r=".95" fill="var(--surface)" stroke="none" />
          <rect x="6.6" y="16" width="10.8" height="4.4" rx="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "steam":
      return <SteamIcon size={size} />;
    case "linux":
      return <Terminal size={size} strokeWidth={1.8} aria-hidden />;
    case "web":
      return <Globe size={size} strokeWidth={1.7} aria-hidden />;
    case "arcade":
      return <Joystick size={size} strokeWidth={1.7} aria-hidden />;
    default:
      return <Gamepad2 size={size} strokeWidth={1.7} aria-hidden />;
  }
}

/** El logotipo de una plataforma.
 *
 *  `hint` es lo que se añade al nombre en el `title`: la fecha de salida en esa
 *  plataforma, cuando IGDB la da por separado. El nombre nunca se pinta — es
 *  toda la gracia de que sean logotipos — así que el `title` y el `aria-label`
 *  son el único sitio donde se lee, y por eso están siempre.
 *
 *  Nunca es pulsable: es una lista informativa. Donde hay que ELEGIR una
 *  plataforma —"en cuál lo juegas", en la ficha del juego— el control es un
 *  chip con el nombre escrito, y este dibujo va dentro con `bare`. Un botón
 *  que solo fuera el logotipo obligaría a pasar por encima para saber si el
 *  que estás tocando es la PS4 o la PS5, y en un móvil no hay «por encima». */
export function PlatformLogo({
  name,
  hint,
  size = 20,
  bare = false,
}: {
  name: string;
  hint?: string | null;
  size?: number;
  /** Sin baldosa: el dibujo suelto, para meterlo dentro de un chip que ya
   *  tiene la suya y que además lleva el nombre escrito. */
  bare?: boolean;
}) {
  const family = platformFamily(name);
  const label = hint ? `${name} · ${hint}` : name;
  const mark = <Mark family={family} size={size} />;

  if (bare) {
    return (
      <span style={{ color: TINT[family], display: "inline-flex", flex: "0 0 auto" }} aria-hidden>
        {mark}
      </span>
    );
  }

  return (
    <span
      className="plat-logo"
      title={label}
      aria-label={label}
      role="img"
      style={{ color: TINT[family], width: size + 14, height: size + 14 }}
    >
      {mark}
    </span>
  );
}
