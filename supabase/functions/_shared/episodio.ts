// episodio.ts — lo que se guarda de la gente de un episodio, y del español.
//
// Vive fuera de index.ts por lo mismo que rank.ts: index.ts llama a Deno.serve
// al importarse, así que nada de lo que hay allí se puede probar. Aquí está lo
// que DECIDE algo sobre los datos, y aquí están sus tests (episodio_test.ts,
// que corre el job `edge` de CI).
//
// Y en _shared/ y no dentro de tmdb-proxy porque lo usan DOS funciones —el
// proxy y el cron episode-refresh— que escriben la misma fila de `episodes`.
// Que una alcance a la otra por `../tmdb-proxy/…` funciona hoy, pero mete a un
// despliegue por función a depender del directorio de otra; _shared es el sitio
// que este repo ya tiene para esto (ver _shared/tmdb.ts).

// deno-lint-ignore no-explicit-any
export type Any = any;

/** Un nombre de la ficha del episodio, recortado a lo que se pinta. */
export interface Persona {
  id: number;
  name: string;
  profile_path: string | null;
  /** El puesto ("Director", "Writer") en el equipo, o el personaje si es invitado. */
  role: string;
}

/* ─────────────────────────── El equipo ────────────────────────────────────
 *
 * TMDB manda el equipo ENTERO de cada episodio: en Severance son 28 personas,
 * y ahí dentro va el montador, el de sonido, el de vestuario y el "unit
 * production manager". La ficha enseña dirección y guion, así que el resto
 * sobra — y no sobra poco: cada persona llega con doce campos (`adult`,
 * `gender`, `popularity`, `known_for_department`, `credit_id`…) y todos esos
 * bytes viajarían en cada lectura de temporada, que es la consulta más
 * caliente que hay.
 *
 * ── Qué cuenta como guion ─────────────────────────────────────────────────
 * En TMDB el departamento "Writing" reparte el trabajo en varios puestos:
 * `Writer` a secas, y también `Screenplay`, `Teleplay` y `Story`. Una serie
 * puede usar cualquiera de ellos —"Teleplay" es lo habitual en televisión
 * americana cuando el guion adapta una historia de otro— y filtrar solo por
 * `Writer` dejaría episodios sin nadie en la línea de guion aunque TMDB sí
 * diga quién lo escribió. Se aceptan los cuatro.
 *
 * `Director` no tiene ese problema: es un puesto único del departamento
 * "Directing" y no hay variantes.
 *
 * ── Por qué el orden es fijo y no el de TMDB ───────────────────────────────
 * El payload trae el equipo en un orden que no significa nada (viene por
 * departamento y dentro de él como caiga). La ficha pone primero la dirección
 * y luego el guion SIEMPRE, porque dos episodios seguidos con las mismas
 * personas en distinto orden se leen como si hubiera cambiado algo. */

const DIRECCION = "Director";
const GUION = new Set(["Writer", "Screenplay", "Teleplay", "Story"]);

/** Una persona del payload, recortada. Null si le falta lo imprescindible —
 *  sin id no se puede enlazar a su página y sin nombre no hay nada que pintar. */
function persona(row: Any, role: string): Persona | null {
  const id = row?.id;
  const name = row?.name;
  if (typeof id !== "number" || typeof name !== "string" || !name) return null;
  return {
    id,
    name,
    profile_path: typeof row?.profile_path === "string" ? row.profile_path : null,
    role,
  };
}

/** Dirección y guion de un episodio, en ese orden y sin repetidos.
 *
 *  Sin repetidos porque es LO NORMAL que se repita: en televisión el creador
 *  dirige y firma el piloto, y TMDB lo devuelve dos veces, una por puesto. En
 *  una fila de caras eso sería la misma cara dos veces seguidas. Se queda con
 *  su primer papel, que por el orden de arriba es la dirección — el más
 *  específico de los dos y el que la gente asocia al episodio.
 *
 *  Devuelve null cuando no hay nadie, no una lista vacía: null es "TMDB no lo
 *  publica todavía" (un episodio sin emitir) y la ficha lo dice con palabras,
 *  mientras que [] se pintaría como una fila vacía. */
export function crewRecortado(crew: readonly Any[] | null | undefined): Persona[] | null {
  const vistos = new Set<number>();
  const out: Persona[] = [];
  for (const [puesto, coincide] of [
    [DIRECCION, (job: string) => job === DIRECCION],
    ["Writer", (job: string) => GUION.has(job)],
  ] as const) {
    for (const row of crew ?? []) {
      const job = row?.job;
      if (typeof job !== "string" || !coincide(job)) continue;
      const p = persona(row, puesto);
      if (!p || vistos.has(p.id)) continue;
      vistos.add(p.id);
      out.push(p);
    }
  }
  return out.length ? out : null;
}

/* ─────────────────────────── Los invitados ────────────────────────────────
 *
 * `guest_stars` ya viene ordenado por `order`, que es el orden de créditos, y
 * ese sí significa algo: el invitado principal va primero. Se respeta.
 *
 * El tope de doce es por peso, no por diseño: la fila hace scroll y podría
 * enseñarlos todos, pero un episodio coral llega con cuarenta y pico y esas
 * cuarenta filas viajarían en cada lectura de la temporada entera. Doce
 * llenan tres pantallas de scroll horizontal, que es más de lo que nadie
 * recorre en una ficha. */
const MAX_INVITADOS = 12;

export function invitadosRecortados(guests: readonly Any[] | null | undefined): Persona[] | null {
  const out: Persona[] = [];
  for (const row of guests ?? []) {
    // Sin personaje se cuela: hay episodios donde TMDB acredita a alguien sin
    // decir a quién hace, y el nombre solo sigue valiendo. La línea de abajo
    // queda vacía, que es la verdad.
    const p = persona(row, typeof row?.character === "string" ? row.character : "");
    if (!p) continue;
    out.push(p);
    if (out.length === MAX_INVITADOS) break;
  }
  return out.length ? out : null;
}

/* ─────────────────────────── El español ───────────────────────────────────
 *
 * La fila española de la misma temporada, cuando la hay. Solo se acepta texto
 * CON CONTENIDO: TMDB devuelve cadena vacía —no la inglesa— cuando falta la
 * traducción, así que copiarla tal cual cambiaría una sinopsis en inglés por
 * ninguna sinopsis.
 *
 * ── Devuelve SIEMPRE las dos claves, y eso es lo importante ────────────────
 * La tentación es omitir la clave cuando no hay traducción, para no pisar lo
 * que un refresco anterior guardó. Con un upsert de UNA fila funcionaría; con
 * el de un LOTE —y una temporada entera es un lote— no: PostgREST construye una
 * sola lista de columnas con la unión de las claves de TODAS las filas, así que
 * en cuanto un episodio de la temporada trae traducción, la columna entra en el
 * INSERT y los que la omitieron reciben un NULL explícito igualmente. La
 * omisión no protege nada; solo hace que el borrado dependa de si al vecino le
 * tocó traducción, que es peor que borrar a propósito. Es la misma trampa que
 * `gameSearchRow` documenta en igdb-proxy/normalize.ts.
 *
 * Lo que sí decide de verdad es QUIÉN llama: se aplica solo cuando la petición
 * en español llegó. Si esa mitad falló, el llamante no usa esto y las dos
 * columnas se quedan fuera del upsert, intactas. */
export function textoEs(es: Any): { name_es: string | null; overview_es: string | null } {
  const name = es?.name;
  const overview = es?.overview;
  return {
    name_es: typeof name === "string" && name.trim() ? name : null,
    overview_es: typeof overview === "string" && overview.trim() ? overview : null,
  };
}
