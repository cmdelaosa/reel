/* Leer una tabla ENTERA por PostgREST, ventana a ventana.
 *
 * Existe por un fallo que no se ve: PostgREST corta en mil filas y no avisa de
 * que lo ha hecho. La respuesta es un 200 con mil filas y un `content-range` que
 * nadie mira, así que una lista leída a medias se pinta como una lista entera.
 * Medido el 25-08-2026 importando el cine de FilmAffinity: 2.107 filas en
 * `library_entries`, y "Tu cine" enseñaba 220 películas de 1.325. No hubo error,
 * ni aviso, ni hueco visible — la rejilla estaba llena.
 *
 * Vivía dentro de lib/library, atado por el nombre a una sola de las lecturas
 * que lo necesitan. Salió de ahí cuando apareció la segunda: la ficha de un
 * amigo lee sus `library_entries` y sus `ratings` sin paginar, y con los tres
 * medios juntos cualquiera con una biblioteca importada pasa de mil — o sea, su
 * perfil de gustos y vuestra afinidad calculados sobre un trozo, sin que nada
 * lo dijera. La tercera lectura que llegue ya tiene de dónde copiarlo bien.
 *
 * El `.order()` de quien llama NO es cosmético, y por eso se repite en cada
 * llamada en vez de esconderse aquí: sin un orden TOTAL, dos ventanas
 * consecutivas pueden repetir filas y saltarse otras —Postgres no promete un
 * orden estable entre consultas— y eso es justo lo que este bucle provoca. Es
 * la misma regla que documenta `supabase/functions/episode-refresh/paging.ts`,
 * que es este mismo bucle del lado del servidor. */

/** El tope de filas que PostgREST devuelve de una tacada, y que no avisa de que
 *  ha aplicado. */
export const PAGE_MAX = 1000;

/** Todas las filas de una consulta, ventana a ventana.
 *
 *  `page(from, to)` es la consulta con su `.order()` y su `.range()` puestos.
 *  Se exporta con ella como parámetro para su matriz de pruebas
 *  (paging.test.ts), que es donde se comprueba que la segunda página se pide y
 *  que una página corta termina. */
export async function fetchPaged(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let from = 0; ; from += PAGE_MAX) {
    const { data, error } = await page(from, from + PAGE_MAX - 1);
    if (error) throw new Error(error.message);
    if (data?.length) all.push(...data);
    // Una página corta es el final. Una llena puede serlo o no, y averiguarlo
    // cuesta una petición más — incluida la página vacía con la que acaba un
    // total que cae justo en un múltiplo del tamaño.
    if (!data || data.length < PAGE_MAX) return all;
  }
}
