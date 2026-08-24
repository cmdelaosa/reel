/* Qué se enseña en Esta noche cuando el modo es Videojuegos. Puro, con tests
   al lado (gameTonight.test.ts).

   Las tres pantallas de Esta noche responden la misma pregunta con distintas
   palabras, y conviene decir cuál es aquí porque es lo que decide todo lo demás:

     · series — "sigue por aquí": el siguiente episodio de lo que ya empezaste.
     · cine   — "elige peli": de lo pendiente, qué puedes poner ya.
     · juegos — "vuelve a lo que estabas": de lo que estás jugando, a qué le
                echaste mano por última vez.

   En juegos NO es "elige juego", y esa es la diferencia con el cine. Una
   película pendiente se elige cada noche; un juego empezado se retoma. Elegir
   entre veinte pendientes es lo que hace que un backlog dé pereza — y para eso
   ya está la pestaña Pendientes, que es donde uno va cuando quiere elegir.

   ── Qué instante ordena ───────────────────────────────────────────────────
   `played_at` (0075), que es cuándo cambiaste las horas o el estado. Con caída
   a `added_at` para las filas que no lo tienen: la migración deliberadamente NO
   rellenó la columna hacia atrás —habría sido inventar una fecha— así que las
   partidas de antes de 0075 se ordenan por cuándo entraron en Reel, que es lo
   único cierto que se sabe de ellas. Es una decisión de presentación, y por eso
   vive aquí y no en la base. */

export interface Playable {
  status: string;
  played_at?: string | null;
  added_at: string;
}

/** El instante que ordena la lista de "vuelve a esto". */
export function touchedMs(g: Playable): number {
  const touched = g.played_at ? new Date(g.played_at).getTime() : 0;
  // added_at es NOT NULL en la tabla, pero una fila optimista recién creada en
  // el cliente podría traer cualquier cosa; un NaN aquí envenenaría el sort
  // entero (comparar con NaN siempre da false y el orden queda arbitrario).
  const added = new Date(g.added_at).getTime();
  return Math.max(touched, Number.isFinite(added) ? added : 0);
}

/** Lo que estás jugando, por lo último que tocaste. El primero es el héroe de
 *  la pantalla y el resto llena el carrusel. */
export function orderByTouched<T extends Playable>(games: readonly T[]): T[] {
  return games.filter((g) => g.status === "playing").sort((a, b) => touchedMs(b) - touchedMs(a));
}

/** El héroe: lo último que tocaste de lo que estás jugando.
 *
 *  Si no estás jugando a nada, cae a lo más reciente de los PENDIENTES que ya
 *  haya salido — que es lo más cerca de "vuelve a lo que estabas" que se puede
 *  decir sin mentir, y evita que la pantalla quede vacía para quien acaba de
 *  empezar en Reel. Nunca cae a un juego sin salir: recomendarte esta noche
 *  algo que no existe todavía es la única respuesta claramente inútil.
 *
 *  'ongoing' NO entra en la caída, y sí en la lista de arriba si lo marcaste
 *  como que lo estás jugando: un CS que no has abierto en un año está en "Sin
 *  final", no en "Jugando", y proponerlo de héroe sería proponer lo que
 *  precisamente dejaste aparcado.
 *
 *  ── 'owned' entra en la caída, detrás de los pendientes (0076) ───────────
 *  Un juego traído de Steam que no has tocado no es 'backlog' —se queda fuera
 *  de ese cubo a propósito, para que la importación no se coma la lista que TÚ
 *  eliges— pero sí es candidato a esta noche: lo tienes y no lo has empezado,
 *  que es exactamente lo que esta caída busca. Sin él, quien llegue a Reel
 *  importando su cuenta de Steam se encuentra la portada de juegos VACÍA, que
 *  es justo el caso que la caída existe para evitar.
 *
 *  Detrás y no mezclado: un pendiente lo pusiste tú ahí, y eso es una señal más
 *  fuerte que "está en tu cuenta de Steam". Dentro de cada grupo, lo más
 *  reciente. */
export function pickResume<T extends Playable>(games: readonly T[]): T | undefined {
  const playing = orderByTouched(games);
  if (playing.length > 0) return playing[0];
  const recent = (status: string) =>
    games.filter((g) => g.status === status).sort((a, b) => touchedMs(b) - touchedMs(a))[0];
  return recent("backlog") ?? recent("owned");
}
