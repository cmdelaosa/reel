import { useEffect, useState } from "react";

/* Montar una rejilla larga por tandas, sin dependencia.

   POR QUÉ. Una biblioteca de 1.700 series montaba 1.700 `Poster` de golpe, cada
   uno con sus hooks (intención de abrir, nombres en español, proveedores), para
   una pantalla que enseña una docena. Medido contra el build de producción el
   19-sep-2026 con CPU 4x: ~620 ms desde la respuesta hasta el primer pintado,
   con una tarea larga de ~300 ms. `loading="lazy"` evitaba bajar las imágenes,
   no montar los componentes.

   CÓMO. Se pinta la primera tanda y un centinela detrás de la rejilla; cuando
   el centinela se acerca al borde de la ventana, entra la siguiente. El margen
   es de varias pantallas, así que al hacer scroll la tanda nueva ya está puesta
   antes de verse, y el tabulador tampoco llega nunca al final de lo montado:
   una tarjeta enfocada se desplaza a la vista y eso ya acerca el centinela.

   Es el mismo centinela de HistoryPage, con una diferencia: el observador se
   rehace en cada tanda. Uno que ya está dentro del margen no vuelve a avisar
   —solo avisa al cruzarlo— y en una pantalla alta la rejilla crecería una vez
   y se pararía con el centinela a la vista; `observe()` siempre emite una
   primera entrada, así que rehacerlo es preguntar de nuevo.

   LO QUE NO CAMBIA. Filtros, contadores y ordenaciones siguen trabajando sobre
   la lista entera: esto solo recorta lo que se MONTA, al final. Y la cuenta
   solo se reinicia cuando cambia `resetKey` (el cubo y el orden), no cuando
   llegan datos nuevos: la revalidación del rollup, o marcar un episodio en la
   ficha, devolvería a alguien que va por la carátula 400 a la tanda primera y
   perdería su sitio al cerrar la ficha, que abre encima de la página.

   EL COSTE. Lo no montado no existe en el DOM: Ctrl+F del navegador no
   encuentra un título que no se ha pintado todavía. */

/** Cuántas carátulas entran por tanda. Sesenta llena la primera pantalla del
 *  escritorio más ancho con filas enteras (sale justo en rejillas de 2, 3, 4,
 *  5 y 6 columnas) y, medido, cuesta unos 30 ms a CPU 4x. */
export const GRID_BATCH = 60;

/** Cuánto por delante de la ventana se pide la tanda siguiente. */
const AHEAD = "0px 0px 1500px 0px";

/** La cuenta siguiente: una tanda más, sin pasarse de la lista. */
export function nextCount(count: number, total: number, step: number): number {
  return Math.min(total, count + step);
}

export function useGrowingList<T>(
  items: T[],
  resetKey: string,
  step = GRID_BATCH,
): { shown: T[]; sentinel: React.ReactNode } {
  const [count, setCount] = useState(step);
  const [key, setKey] = useState(resetKey);
  // Ajuste durante el render (el patrón documentado de React para derivar de
  // props): se vuelve a renderizar antes de pintar, así que no parpadea.
  if (key !== resetKey) {
    setKey(resetKey);
    setCount(step);
  }
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const done = count >= items.length;

  useEffect(() => {
    if (!el || done) return;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) setCount((c) => nextCount(c, items.length, step));
      },
      { rootMargin: AHEAD },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, done, count, items.length, step]);

  return {
    shown: done ? items : items.slice(0, count),
    // Un píxel de alto y sin márgenes: no mueve nada al aparecer ni al irse.
    sentinel: done ? null : <div ref={setEl} className="grid-sentinel" aria-hidden="true" style={{ height: 1 }} />,
  };
}
