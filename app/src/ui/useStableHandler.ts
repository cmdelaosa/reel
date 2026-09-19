import { useCallback, useLayoutEffect, useRef } from "react";

/* Un manejador con identidad fija que siempre llama a la última versión.

   Para las tarjetas memoizadas de una rejilla (ui/GrowingList): si cada tanda
   nueva les pasara un `onOpen` recién creado, `memo` no serviría de nada y
   montar la tanda 28 re-renderizaría las 1.620 carátulas de antes — medido,
   ~220 ms a CPU 4x. `setSearchParams` cambia de identidad con cada cambio de la
   URL, así que no basta con un useCallback sobre él.

   La referencia se actualiza en un efecto de layout, no durante el render: un
   clic siempre llega después del commit, así que nunca ve una versión vieja. */
export function useStableHandler<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
