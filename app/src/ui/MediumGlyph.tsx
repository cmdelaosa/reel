import { Film, Gamepad2, Tv } from "lucide-react";
import { t as tr } from "@/lib/i18n";

/* De qué medio es esta fila, en las listas donde conviven los dos: el muro de
   amigos, el historial y la filmografía de una persona.

   Se pinta SIEMPRE, también en las de series, y ese es el punto: un glifo que
   solo aparece en las películas no se lee como "esto es cine" sino como una
   marca rara sobre algunas filas, y obliga a saberse la convención para
   entenderla. Presente en las dos, la columna se lee sola.

   Y solo en las listas mezcladas. Dentro del modo cine no hace falta —todo lo
   es— y ahí sería ruido en cada fila. */
export function MediumGlyph({ kind, size = 13 }: { kind: "tv" | "movie" | "game"; size?: number }) {
  const Icon = kind === "movie" ? Film : kind === "game" ? Gamepad2 : Tv;
  return (
    // `title` y no `aria-label`: con role="img" el title ya es el nombre
    // accesible, así que poner los dos hacía que varios lectores anunciaran
    // "Película, Película" en cada una de las treinta filas del muro. Y el
    // title, además, se ve al pasar el ratón, que es como se aprende un glifo.
    <span
      role="img"
      title={tr(kind === "movie" ? "Movie" : kind === "game" ? "Game" : "TV series")}
      style={{ display: "inline-flex", flex: "0 0 auto", color: "var(--text-mute)" }}
    >
      <Icon size={size} />
    </span>
  );
}
