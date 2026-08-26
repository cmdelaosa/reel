/* Cuántas pestañas de la barra caben en el hueco que hay. Puro, con tests al
   lado (tabFit.test.ts).

   La barra tenía una sola respuesta al desbordamiento: el carril se deslizaba y
   un desvanecido decía que había más. Medido el 26-08-2026 en modo Juegos, en
   español, a 1280px y también a 1920: el carril pedía 706px y tenía 575, así
   que 131px se quedaban fuera SIEMPRE —"Amigos" entero y un tercio de Steam—,
   y daba igual el tamaño del monitor porque la barra estaba topada a 1280.

   Lo que sustituye al desvanecido es esto: se cuenta lo que cabe y el resto se
   recoge en un menú. La diferencia no es de adorno. Una pestaña en un menú
   ESTÁ: se ve que existe, se puede llegar a ella y el teclado la encuentra. Una
   pestaña detrás de un degradado no está en ninguna parte.

   Vive en domain porque es aritmética con tres o cuatro trampas de una unidad
   —el hueco entre pestañas se cuenta una vez menos que las pestañas, salvo
   cuando aparece el botón del menú, que añade el suyo— y esas se prueban con
   una tabla, no mirando una barra en un navegador. */

/** Cuántas de `widths`, de izquierda a derecha, se pintan como pestaña. Las que
 *  sobren van al menú, y entonces el botón del menú ocupa sitio también.
 *
 *  Todas las medidas en px del navegador, ya redondeadas o no: la comparación
 *  es `<=`, así que un ajuste exacto cabe.
 *
 *  - `widths`   lo que mide cada pestaña con su rótulo entero.
 *  - `gap`      el hueco entre dos elementos de la fila.
 *  - `available` el ancho de contenido del carril.
 *  - `moreWidth` lo que mide el botón «···».
 */
export function fittingTabs({
  widths,
  gap,
  available,
  moreWidth,
}: {
  widths: readonly number[];
  gap: number;
  available: number;
  moreWidth: number;
}): number {
  const n = widths.length;
  if (n === 0) return 0;

  /* Sin hueco medido todavía no se decide nada: se enseñan todas. Pasa en dos
     momentos, y en los dos esconder sería peor que desbordar — antes del primer
     `layout`, cuando aún no hay caja que medir, y en el móvil, donde el carril
     está en `display: none` y quien manda es el dock de abajo. Un cero aquí
     tratado como "no cabe nada" mandaría las seis al menú y dejaría la barra
     enseñando un «···» solitario durante un fotograma. */
  if (!Number.isFinite(available) || available <= 0) return n;

  /* Todas, sin menú: entonces no hay que reservarle sitio al botón, que es lo
     que hace que este caso no sea el bucle de abajo con k = n. */
  const total = sum(widths, n) + gap * (n - 1);
  if (total <= available) return n;

  /* Y si no caben todas, k pestañas y el botón son k + 1 elementos en la fila,
     o sea k huecos: uno entre cada dos pestañas y otro antes del botón. */
  for (let k = n - 1; k >= 1; k--) {
    if (sum(widths, k) + gap * k + moreWidth <= available) return k;
  }
  return 0;
}

const sum = (widths: readonly number[], upTo: number): number => {
  let total = 0;
  for (let i = 0; i < upTo; i++) total += widths[i];
  return total;
};
