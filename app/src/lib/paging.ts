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

/** Los comienzos de las ventanas que faltan, sabiendo el total y lo que trajo
 *  la primera.
 *
 *  `step` es lo que VINO, no lo que se pidió: el tope de filas es ajuste del
 *  servidor, y si sirviera menos de lo pedido, calcular los tramos con el
 *  tamaño pedido dejaría huecos silenciosos — el mismo truncamiento invisible
 *  que este módulo existe para arreglar.
 *
 *  Vivía en lib/i18n, que fue quien primero necesitó pedir en paralelo. Salió
 *  de ahí cuando la biblioteca necesitó lo mismo: es aritmética de paginado, no
 *  de idiomas. */
export function restOffsets(total: number, step: number): number[] {
  if (step <= 0 || total <= step) return [];
  return Array.from({ length: Math.ceil((total - step) / step) }, (_, i) => step + i * step);
}

interface PageError {
  message: string;
  /** El código de PostgREST, cuando lo trae. Viaja hasta quien llama porque
   *  hay un error que NO es un fallo: PGRST202 —"esa función no existe"— es lo
   *  que recibe un cliente nuevo contra una base sin migrar, y ahí lo correcto
   *  es reintentar de otra forma, no rendirse. Sin esto habría que adivinarlo
   *  del texto del mensaje, que cambia. */
  code?: string;
}

interface Page {
  data: unknown[] | null;
  error: PageError | null;
  /** El total del conjunto, que solo viene si se pidió (`count: "exact"`). */
  count?: number | null;
}

/** El error de una ventana, como Error y sin perder el código. */
export class PagingError extends Error {
  readonly code?: string;
  constructor(error: PageError) {
    super(error.message);
    this.name = "PagingError";
    this.code = error.code;
  }
}

/** Todas las filas, pero sin que las ventanas esperen unas por otras.
 *
 *  `fetchPaged` encadena: hasta que no vuelve una ventana no se sabe si hay
 *  otra, así que la lectura tarda LA SUMA de todas. Medido en producción el
 *  18-sep-2026 con una biblioteca de 2.109 filas, las tres ventanas del rollup
 *  iban 168→3269, 3273→4861 y 4865→5217 ms: 5,2 s de reloj para 5,0 s de
 *  trabajo que podían solaparse, y ni un póster pedido hasta el final.
 *
 *  Aquí la PRIMERA ventana trae además el total (`count: "exact"`), y con el
 *  total se sabe cuántas quedan sin preguntarlo: van todas a la vez y el reloj
 *  pasa a ser el de la más lenta. De paso se ahorra la petición que solo servía
 *  para descubrir que no quedaba nada — incluida la ventana vacía con la que
 *  `fetchPaged` acaba un total múltiplo exacto del tamaño.
 *
 *  El COUNT se pide SOLO en la primera: no es gratis, y pedirlo también en las
 *  que van en paralelo sería pagarlo tantas veces como ventanas haya para tirar
 *  todas las respuestas menos una.
 *
 *  Lo que NO cambia es la garantía de este módulo: quien llama sigue poniendo
 *  su `.order()` TOTAL, porque sin él dos ventanas pueden repetir filas y
 *  saltarse otras — y en paralelo eso no es más seguro, solo más rápido.
 *
 *  El precio, dicho claro: el servidor hace el mismo trabajo total, pero ahora
 *  a la vez. Para una función cara —el rollup recalcula sus agregados en cada
 *  ventana, ver el comentario de la migración 0098— son N consultas caras
 *  simultáneas en vez de en fila. Se acepta porque N es 2 o 3 y porque el
 *  filtro por medio de 0099 baja ese N para las tres pantallas que importan. */
export async function fetchPagedParallel(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<Page>,
): Promise<unknown[]> {
  const first = await page(0, PAGE_MAX - 1, true);
  if (first.error) throw new PagingError(first.error);
  const rows = [...(first.data ?? [])];

  /* Sin total no se adivina: se vuelve a encadenar hasta la ventana vacía, que
     es lento pero completo. `count ?? rows.length` parecía razonable y era una
     trampa — daría "no queda nada" ante un total desconocido y truncaría en
     silencio justo lo que este paginado arregla. */
  if (first.count == null) {
    for (;;) {
      const more = await page(rows.length, rows.length + PAGE_MAX - 1, false);
      if (more.error) throw new PagingError(more.error);
      const got = more.data ?? [];
      if (got.length === 0) return rows;
      rows.push(...got);
    }
  }

  const total = first.count;
  const step = rows.length;
  const rest = await Promise.all(
    // La flecha explícita no es adorno: `.map(page)` le pasaría el ÍNDICE como
    // segundo argumento, que aquí es el final de la ventana.
    restOffsets(total, step).map((from) => page(from, from + step - 1, false)),
  );
  for (const r of rest) {
    if (r.error) throw new PagingError(r.error);
    rows.push(...(r.data ?? []));
  }

  /* La red de debajo de la red. Las ventanas en paralelo tesela el total en
     tramos de `step`, y eso supone que todas traen lo mismo que la primera. Si
     una viniera corta —el servidor aprieta el tope a mitad de lectura— faltarían
     filas sin un solo error, que es exactamente el fallo que este módulo
     persigue. Así que si al final hay menos de las que el total prometía, se
     terminan encadenando. En la lectura normal este bucle no se ejecuta. */
  while (rows.length < total) {
    const more = await page(rows.length, rows.length + PAGE_MAX - 1, false);
    if (more.error) throw new PagingError(more.error);
    const got = more.data ?? [];
    if (got.length === 0) break;
    rows.push(...got);
  }
  return rows;
}
