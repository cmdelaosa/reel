/* Ordenar una rejilla de biblioteca por un campo suyo, en los dos sentidos.
 *
 *  Nace con la barra de Juegos de 0102, donde los siete órdenes pasaron a
 *  voltearse y no solo «Puntuado». Hasta entonces cada orden era una resta
 *  suelta en la página —`(b.vote_average ?? 0) - (a.vote_average ?? 0)`— y eso
 *  bastaba porque el sentido nunca cambiaba. En cuanto cambia, esas restas
 *  esconden un fallo que solo aparece volteadas, y es el mismo que ratedSort
 *  documenta desde el principio:
 *
 *  **Lo que no tiene el dato va al final SIEMPRE, en los dos sentidos.** Un
 *  juego sin nota de IGDB no es un juego con un 0, y un juego sin fecha de
 *  salida no salió el año 0. Tratarlos como el mínimo funciona de casualidad
 *  mientras solo pides «de mayor a menor» —caen al fondo, que es donde van—, y
 *  en cuanto pides «de menor a mayor» te llenan la primera pantalla con
 *  doscientos juegos sobre los que la biblioteca no sabe nada. Lo que se busca
 *  en ese orden es el peor valorado, no los que nadie valoró.
 *
 *  **Empate deshecho por nombre**, y no por el orden en que llegaran las filas:
 *  los empates son la norma —cientos de juegos a 0 minutos, cientos de notas
 *  importadas con el mismo instante— y sin desempate la rejilla baila entre
 *  repintados.
 *
 *  `dir` habla del VALOR, no de la etiqueta: "desc" es de mayor a menor (o de
 *  la Z a la A), "asc" al revés. Cuál de los dos es el natural de cada orden lo
 *  decide quien pinta la barra —«A–Z» empieza en "asc" y «Horas» en "desc"—
 *  porque eso es lenguaje de la etiqueta y no de los datos. */

import type { SortDir } from "@/domain/ratedSort";

/** El desempate común: el nombre, que toda fila de biblioteca tiene. */
interface Sortable {
  name: string;
}

/** Comparador por un valor de la propia fila. `null` = la fila no tiene ese
 *  dato, y se va al final en los dos sentidos. */
export function byValue<T extends Sortable>(
  of: (x: T) => number | string | null,
  dir: SortDir,
): (a: T, b: T) => number {
  return (a, b) => {
    const va = of(a);
    const vb = of(b);
    if (va === null || vb === null) {
      if (va === vb) return a.name.localeCompare(b.name);
      return va === null ? 1 : -1;
    }
    const d =
      typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    if (d !== 0) return dir === "desc" ? -d : d;
    return a.name.localeCompare(b.name);
  };
}

/** El sentido contrario. Vive aquí y no en la página porque las tres
 *  bibliotecas tendrán el mismo gesto en cuanto esto salga de Juegos. */
export function flipDir(dir: SortDir): SortDir {
  return dir === "desc" ? "asc" : "desc";
}
