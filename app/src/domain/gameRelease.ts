/* Cómo se escribe la fecha de salida de un juego, que no es como la de un
   episodio ni la de un estreno.

   IGDB acompaña cada fecha de un formato —día exacto, mes, trimestre, año o
   TBD— porque muchos juegos se anuncian sin día, y ADEMÁS devuelve siempre un
   timestamp concreto: un "Q4 2027" llega con un día de diciembre que nadie ha
   prometido. La migración 0071 guarda las dos cosas, la fecha y su
   `release_precision`, precisamente para que esto se pueda escribir sin
   inventar.

   La regla: **nunca imprimir más precisión de la que la fuente dio**. Si IGDB
   dice "Q4 2027", aquí sale "Q4 2027" — no "31 de diciembre de 2027", que es el
   día que se guarda para poder ordenar y que es un detalle de almacenamiento,
   no una promesa de nadie. */

export type ReleasePrecision = "day" | "month" | "q1" | "q2" | "q3" | "q4" | "year" | "tbd";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface FormatReleaseOptions {
  /** Español cuando true; inglés si no. Se pasa desde fuera para que esto siga
   *  siendo puro y probable sin montar el i18n. */
  es?: boolean;
  /** Lo que se escribe cuando no hay fecha ninguna. */
  tbdLabel?: string;
}

/** La fecha de salida tal y como se puede afirmar.
 *
 *  `date` es el ÚLTIMO día del periodo anunciado (así lo guarda 0071), y por eso
 *  para todo lo que no sea 'day' se usa solo el año que lleva dentro: el día y
 *  el mes de esa cadena son relleno para poder ordenar. */
export function formatRelease(
  date: string | null | undefined,
  precision: ReleasePrecision | null | undefined,
  { es = false, tbdLabel = es ? "Sin fecha" : "TBA" }: FormatReleaseOptions = {},
): string {
  if (!date || precision === "tbd" || !precision) return tbdLabel;

  const [y, m, d] = date.split("-").map(Number);
  if (!y) return tbdLabel;

  switch (precision) {
    case "day": {
      if (!m || !d) return String(y);
      return es ? `${d} ${MONTHS_ES[m - 1]} ${y}` : `${MONTHS_EN[m - 1]} ${d}, ${y}`;
    }
    case "month": {
      if (!m) return String(y);
      const name = es ? MONTHS_ES[m - 1] : MONTHS_EN[m - 1];
      return es ? `${name} ${y}` : `${name} ${y}`;
    }
    case "q1":
    case "q2":
    case "q3":
    case "q4":
      // "Q4 2027" se lee igual en los dos idiomas y es como lo escribe la
      // industria; traducirlo a "4.º trimestre de 2027" sería más largo y menos
      // reconocible.
      return `${precision.toUpperCase()} ${y}`;
    case "year":
      return String(y);
  }
}

/** ¿Ya salió? Con una fecha ancha, solo cuando el periodo ENTERO ha pasado.
 *
 *  Es la misma cautela con la que 0071 elige guardar el último día del periodo:
 *  de los dos errores posibles, decir "todavía no" de algo que ya salió se
 *  corrige solo en cuanto IGDB le pone día exacto, mientras que decir "ya está
 *  fuera" de algo que no existe manda a alguien a buscarlo. */
export function isReleased(
  date: string | null | undefined,
  precision: ReleasePrecision | null | undefined,
  today: string,
): boolean {
  if (!date || precision === "tbd" || !precision) return false;
  return date <= today;
}

/* ── Agrupar lanzamientos cuando la fecha no siempre es un día ─────────────
 *
 * El calendario de series y el de cine agrupan por DÍA porque en esos dos
 * medios la fecha siempre es un día. En juegos no: IGDB fecha buena parte del
 * catálogo por trimestre o por año, y un separador de día no puede colocar un
 * "Q4 2027" — el 31 de diciembre que 0071 guarda es relleno para poder ordenar,
 * no una promesa.
 *
 * La regla es la misma que la de formatRelease, aplicada al eje vertical: cada
 * fila se agrupa por el periodo MÁS ESTRECHO que su fuente permite afirmar. Un
 * feed con separadores de granularidad mezclada —"MAÑANA", "marzo 2027",
 * "Q4 2027", "2028"— no es un defecto: es lo que un catálogo de juegos sabe, y
 * es como lo escribe la propia industria.
 */

export type ReleaseGroupKind = "day" | "month" | "quarter" | "year" | "tbd";

export interface Releasable {
  first_air_date: string | null;
  release_precision?: ReleasePrecision | string | null;
}

export interface ReleaseGroup<T> {
  /** Identidad del grupo, estable entre render y render ('2027-11-15',
   *  '2027-11', '2027-Q4', '2028', 'tbd'). */
  key: string;
  kind: ReleaseGroupKind;
  /** La fecha guardada que representa al grupo, para escribir su rótulo con
   *  formatRelease. Null solo en el grupo sin fecha. */
  date: string | null;
  precision: ReleasePrecision | null;
  items: T[];
}

/** Orden entre precisiones que caen en el mismo día guardado.
 *
 *  Hace falta porque el día guardado NO desempata: un "Q4 2027" y un "2027" se
 *  guardan los dos como 2027-12-31 (el final de su periodo). De lo estrecho a
 *  lo ancho, que es también de lo más cierto a lo menos. */
const RANK: Record<ReleaseGroupKind, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

const KIND: Record<ReleasePrecision, ReleaseGroupKind> = {
  day: "day", month: "month",
  q1: "quarter", q2: "quarter", q3: "quarter", q4: "quarter",
  year: "year", tbd: "tbd",
};

const asPrecision = (p: unknown): ReleasePrecision | null =>
  typeof p === "string" && p in KIND ? (p as ReleasePrecision) : null;

/** El grupo al que pertenece una fila: su clave y de qué tipo es. */
export function releaseGroupOf(row: Releasable): { key: string; kind: ReleaseGroupKind } {
  const precision = asPrecision(row.release_precision);
  const date = row.first_air_date;
  if (!date || !precision || precision === "tbd") return { key: "tbd", kind: "tbd" };

  const [y, m] = date.split("-");
  switch (KIND[precision]) {
    case "day": return { key: date, kind: "day" };
    case "month": return { key: `${y}-${m}`, kind: "month" };
    case "quarter": return { key: `${y}-${precision.toUpperCase()}`, kind: "quarter" };
    default: return { key: y, kind: "year" };
  }
}

/** Los lanzamientos agrupados y en orden cronológico, del más antiguo al más
 *  lejano, con lo indatable al final.
 *
 *  "Sin fecha" va SIEMPRE el último y no donde caiga su fecha, porque no tiene:
 *  colarlo entre dos años sería colocarlo, que es lo que este módulo entero
 *  existe para no hacer. */
export function groupReleases<T extends Releasable>(rows: readonly T[]): ReleaseGroup<T>[] {
  const groups = new Map<string, ReleaseGroup<T>>();
  for (const row of rows) {
    const { key, kind } = releaseGroupOf(row);
    const held = groups.get(key);
    if (held) {
      held.items.push(row);
      continue;
    }
    groups.set(key, {
      key,
      kind,
      date: kind === "tbd" ? null : row.first_air_date,
      precision: kind === "tbd" ? null : asPrecision(row.release_precision),
      items: [row],
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.kind === "tbd" || b.kind === "tbd") return RANK[a.kind] - RANK[b.kind];
    const byDate = (a.date ?? "").localeCompare(b.date ?? "");
    return byDate !== 0 ? byDate : RANK[a.kind] - RANK[b.kind];
  });
}
