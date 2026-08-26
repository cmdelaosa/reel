import { Film, Gamepad2, Tv } from "lucide-react";
import { mediumLabel, type Medium } from "@/domain/mediumCopy";
import { t as tr } from "@/lib/i18n";

/* De qué medio es esta fila, en las listas donde conviven los dos: el muro de
   amigos, el historial y la filmografía de una persona.

   Se pinta SIEMPRE, también en las de series, y ese es el punto: un glifo que
   solo aparece en las películas no se lee como "esto es cine" sino como una
   marca rara sobre algunas filas, y obliga a saberse la convención para
   entenderla. Presente en las dos, la columna se lee sola.

   Y solo en las listas mezcladas. Dentro del modo cine no hace falta —todo lo
   es— y ahí sería ruido en cada fila. */
export function MediumGlyph({ kind, size = 13, tone = "mute" }: { kind: Medium; size?: number; tone?: "mute" | "accent" }) {
  const Icon = kind === "movie" ? Film : kind === "game" ? Gamepad2 : Tv;
  return (
    // `title` y no `aria-label`: con role="img" el title ya es el nombre
    // accesible, así que poner los dos hacía que varios lectores anunciaran
    // "Película, Película" en cada una de las treinta filas del muro. Y el
    // title, además, se ve al pasar el ratón, que es como se aprende un glifo.
    <span
      role="img"
      title={tr(mediumLabel(kind))}
      /* Apagado en una lista, donde es una marca al margen de la fila; con el
         acento cuando ES el icono de algo —la cifra de un medio en el perfil—,
         y allí el acento es el del medio porque el bloque lo redefine con
         `data-tint` (tokens.css). */
      style={{ display: "inline-flex", flex: "0 0 auto", color: tone === "accent" ? "var(--accent)" : "var(--text-mute)" }}
    >
      <Icon size={size} />
    </span>
  );
}
