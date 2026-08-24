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
