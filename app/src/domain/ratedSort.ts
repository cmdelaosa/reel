/* Ordenar tu biblioteca por CUÁNDO puntuaste cada cosa.
 *
 *  Es el único orden de la rejilla que no sale de la fila de la biblioteca: la
 *  nota vive en `ratings`, otra tabla, así que quien ordena trae un mapa
 *  title_id → instante (lib/ratings, useRatedAt) y esto lo aplica. Vale para
 *  los tres medios porque solo mira el title_id, que es la clave común — y no
 *  el tmdb_id, que solo es único dentro de su medio (0067).
 *
 *  Dos reglas, y las dos importan:
 *
 *  - **Lo sin puntuar va al final SIEMPRE**, en los dos sentidos. Tratar «no
 *    tiene nota» como el instante 0 pondría media biblioteca por delante de lo
 *    puntuado en cuanto pidieras «lo primero que puntué», y lo que se busca ahí
 *    es esa película, no las cuatrocientas que nunca tocaste.
 *  - **Empate deshecho por nombre**, porque los empates son la norma y no la
 *    excepción: una importación escribe cientos de notas con el mismo instante
 *    (steam-sync sella todas las suyas con un único `now`), y sin desempate el
 *    orden dentro de ese bloque es el que Postgres devolviera ese día. */

export type SortDir = "desc" | "asc";

/** El instante de cada nota tuya, por título. */
export type RatedAt = ReadonlyMap<string, number>;

interface Sortable {
  title_id: string;
  name: string;
}

/** Comparador por fecha de puntuación. `desc` = lo último puntuado arriba. */
export function byRatedAt<T extends Sortable>(ratedAt: RatedAt, dir: SortDir): (a: T, b: T) => number {
  return (a, b) => {
    const ta = ratedAt.get(a.title_id);
    const tb = ratedAt.get(b.title_id);
    if (ta === undefined || tb === undefined) {
      if (ta === tb) return a.name.localeCompare(b.name);
      return ta === undefined ? 1 : -1;
    }
    if (ta !== tb) return dir === "desc" ? tb - ta : ta - tb;
    return a.name.localeCompare(b.name);
  };
}
