/* Cuándo la importación de Steam ha casado con la ficha equivocada — o mejor
   dicho, cuándo hay motivos para sospecharlo y enseñárselo a quien decide.

   El 27-ago-2026 una importación metió en la biblioteca "Agatha Christie: The
   ABC Murders" de 2009, exclusivo de Nintendo DS, porque IGDB cuelga de esa
   ficha el appid del juego de 2016 que sí está en Steam. En la pantalla de
   confirmar no se veía nada raro: mismo nombre, misma carátula (la de Steam) y
   las mismas horas. Y en la biblioteca acabaron los dos juegos, el que ya
   seguías y el recién importado.

   Adivinarlo en el servidor se probó y se descartó: no hay dato que distinga un
   vínculo roto de IGDB de una reedición legítima —Maui Mallard in Cold Shadow
   se vende en Steam y en IGDB es un juego de Super Nintendo del 96—. Así que
   esto no decide nada. Solo señala la coincidencia que una persona reconoce de
   un vistazo: **ya sigues un juego que se llama igual, y esto ha casado con
   otra ficha**. Con el año y la plataforma delante, "2009 · Nintendo DS" contra
   "lo juego en PC" se resuelve solo. */

/** El nombre reducido a lo que dos ediciones del mismo juego comparten.
 *
 *  Steam escribe "Agatha Christie - The ABC Murders" y IGDB "Agatha Christie:
 *  The ABC Murders": los dos puntos, el guion y los acentos son justo lo que
 *  cambia entre catálogos, así que se van. Lo que queda son las letras y los
 *  números, en minúsculas y con un solo espacio.
 *
 *  Deliberadamente tonto: no quita "the", ni números romanos, ni subtítulos.
 *  Esto solo levanta la mano para que mires, y una mano levantada de más cuesta
 *  una mirada — pero un nombre "normalizado" a lo bruto casaría Doom con Doom
 *  II y la señal dejaría de significar nada. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Un juego de tu biblioteca, para lo poco que esto necesita saber. */
export interface MyGame {
  titleId: string;
  name: string;
  /** El año de la ficha, o null. Se enseña: es lo que distingue las ediciones. */
  year: string | null;
  /** En cuál lo juegas TÚ (0083), si lo has dicho. Es el dato que más rápido
   *  desmiente un mal casado: si juegas a esto en PC, la ficha de Nintendo DS
   *  no es la tuya. */
  platform: string | null;
}

/** Tu biblioteca indexada por nombre, que es como la pregunta de abajo se hace
 *  una vez y no trescientas.
 *
 *  Lo pide el tamaño real del problema: una importación de Steam son cientos de
 *  filas y una biblioteca importada, cientos de juegos. Preguntando fila a fila
 *  contra la lista entera son cien mil normalizaciones de nombre POR RENDER, y
 *  esta lista se vuelve a pintar cada vez que marcas una casilla.
 *
 *  Con dos ediciones tuyas del mismo nombre gana la primera, y da igual cuál:
 *  lo que el aviso dice es "ya tienes esto", y con cualquiera de las dos es
 *  verdad. */
export function byName(mine: readonly MyGame[]): Map<string, MyGame> {
  const index = new Map<string, MyGame>();
  for (const game of mine) {
    const key = nameKey(game.name);
    if (key && !index.has(key)) index.set(key, game);
  }
  return index;
}

/** ¿Sigues ya este juego, pero con OTRA ficha?
 *
 *  Devuelve esa otra ficha tuya, o null si no la hay. Null es también lo que
 *  devuelve cuando la importación ha casado con la ficha que ya sigues, que es
 *  el caso normal y no tiene nada que contar. */
export function otherEdition(
  matched: { id: string; name: string } | null | undefined,
  mine: ReadonlyMap<string, MyGame>,
): MyGame | null {
  if (!matched) return null;
  const key = nameKey(matched.name);
  if (!key) return null;
  const found = mine.get(key);
  return found && found.titleId !== matched.id ? found : null;
}
