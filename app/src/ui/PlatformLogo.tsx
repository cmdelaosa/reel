import { Gamepad2, Globe, Joystick } from "lucide-react";
import { platformModel, type PlatformModel } from "@/domain/platformModel";
import { PLATFORM_MARKS } from "@/ui/icons/platformMarks";

/* La marca de una plataforma de videojuegos, en una pastilla.
 *
 * Es la hermana de ui/NetworkLogo para el tercer medio, y nace del mismo
 * problema con la respuesta contraria. Los logotipos de las cadenas los sirve
 * TMDB como imagen; los de las plataformas no los sirve nadie — IGDB tiene
 * `platform_logo`, pero son cientos de PNG en blanco y negro de tamaños
 * dispares, y traerlos costaría una columna nueva, un despliegue del proxy y
 * una ficha vieja enseñando huecos hasta que se refresque. Así que viajan con
 * la app (ui/icons/platformMarks) y son los oficiales, uno por MODELO.
 *
 * ── Por qué esto ya no es una baldosa cuadrada ────────────────────────────
 * Porque los logotipos no lo son. Nintendo casi nunca hizo un símbolo, hizo
 * palabras: el de la Nintendo 64 mide 6,9 veces más de ancho que de alto y el
 * de la DS 7,3. Metidos en un cuadrado de 30 px se quedan en una raya de dos
 * píxeles de alto — que es exactamente lo que pasaba mientras el juego de
 * logotipos venía de Simple Icons tal cual, porque ese catálogo mete todo en
 * 24×24 cueste lo que cueste.
 *
 * Así que `size` es la ALTURA del dibujo, nunca su lado, y cada marca se lleva
 * el ancho que le pide su proporción (`r`). La pastilla crece con él y tiene un
 * mínimo cuadrado, para que los símbolos —Xbox, Switch, la manzana— sigan
 * siendo cuadrados y la fila no parezca rota.
 *
 * El color es el de la marca y no el del tema: es la mitad de lo que hace que
 * se reconozca de un vistazo a 16 px. Vive en tokens.css como `--plat-*`
 * porque no es el mismo en claro que en oscuro — el negro de Apple y el verde
 * de Xbox desaparecen sobre #0b0d12, y el celeste de Steam sobre el blanco. */

function Trazo({ model, size }: { model: PlatformModel; size: number }) {
  if (!model.mark) {
    // Sin marca que copiar: pictograma de lucide. Nunca un hueco.
    const props = { size, strokeWidth: 1.7, "aria-hidden": true } as const;
    if (model.family === "web") return <Globe {...props} />;
    if (model.family === "arcade") return <Joystick {...props} />;
    return <Gamepad2 {...props} />;
  }
  const m = PLATFORM_MARKS[model.mark];
  return (
    <svg
      viewBox={m.vb}
      height={size}
      width={size * m.r}
      /* `duo` son las dos que llevan el color dentro —Switch 2 y Game Boy
         Advance, texto blanco recortado sobre un fondo—: a una tinta se
         convierten en un borrón, así que se pintan con las suyas. */
      fill={"duo" in m && m.duo ? undefined : "currentColor"}
      aria-hidden
      /* Los trazados son datos nuestros, generados en tiempo de construcción y
         sin nada de fuera: no hay entrada de usuario que pueda llegar aquí. */
      dangerouslySetInnerHTML={{ __html: m.body }}
    />
  );
}

/** El dibujo suelto, con su color de marca y sin pastilla: para meterlo dentro
 *  de un control que ya tiene la suya y que además lleva el nombre escrito —
 *  ui/PlatformPicker. Se le pasa el modelo ya resuelto y no el nombre, porque
 *  el desplegable resuelve por `playPlatform` (donde el ordenador entero es
 *  «PC») y la ficha por `platformModel`: con el nombre a secas, un «PC»
 *  guardado saldría con la ventana de Windows en un menú que ofrece Steam. */
export function PlatformMarkIcon({ model, size }: { model: PlatformModel; size: number }) {
  return (
    <span style={{ color: `var(--plat-${model.family})`, display: "inline-flex", flex: "0 0 auto" }} aria-hidden>
      <Trazo model={model} size={size} />
    </span>
  );
}

/** El logotipo de una plataforma.
 *
 *  `hint` es lo que se añade al nombre en el `title`: la fecha de salida en esa
 *  plataforma, cuando IGDB la da por separado. El nombre nunca se pinta — es
 *  toda la gracia de que sean logotipos — así que el `title` y el `aria-label`
 *  son el único sitio donde se lee, y por eso están siempre. Con las marcas por
 *  modelo la mitad de los logotipos SON el nombre escrito, pero solo la mitad:
 *  la esfera de Xbox no dice si es una 360 o una Series X.
 *
 *  Nunca es pulsable: es una lista informativa. Donde hay que ELEGIR una
 *  plataforma —«en cuál lo juegas»— el control es ui/PlatformPicker, que pinta
 *  el dibujo suelto con `PlatformMarkIcon` y el nombre exacto escrito al lado. */
export function PlatformLogo({
  name,
  hint,
  size = 20,
}: {
  name: string;
  hint?: string | null;
  /** La ALTURA del dibujo. El ancho lo pone cada marca. */
  size?: number;
}) {
  const model = platformModel(name);
  const label = hint ? `${model.label} · ${hint}` : model.label;

  return (
    <span
      className="plat-logo"
      title={label}
      aria-label={label}
      role="img"
      style={{ color: `var(--plat-${model.family})`, height: size + 14, minWidth: size + 14 }}
    >
      <Trazo model={model} size={size} />
    </span>
  );
}
