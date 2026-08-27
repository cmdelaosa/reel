/* La etiqueta de las reseñas de Steam, calculada aquí y no guardada.
 *
 * ── Por qué no se guarda ──────────────────────────────────────────────────
 * La tienda devuelve su propio `review_score_desc` ("Overwhelmingly Positive"),
 * y la tentación es guardarlo. Sería un error por dos motivos: viene en el
 * idioma que la tienda respondiera el día del refresco —o sea inglés, siempre—
 * y es TEXTO DE INTERFAZ, que en esta app se traduce con t(). Guardado, un
 * usuario en español leería la ficha entera traducida menos esa línea.
 *
 * Lo que se guarda (0086) son los dos números de los que sale: el porcentaje de
 * positivas y cuántas hay. Con ellos la etiqueta se reconstruye en el idioma de
 * quien mira, y además se puede cambiar el criterio sin refrescar la base.
 *
 * ── Los tramos son los de Steam ───────────────────────────────────────────
 * No inventados: son los que la tienda publica y usa en sus propias fichas. Lo
 * que los hace peculiares es que NO dependen solo del porcentaje — el número de
 * reseñas mueve la etiqueta arriba y abajo dentro del mismo porcentaje. Un 97%
 * de treinta personas es "Positivas"; el mismo 97% de ochocientas mil es
 * "Extremadamente positivas". Es deliberado: con pocas reseñas el porcentaje no
 * significa gran cosa, y la etiqueta no debe fingir que sí.
 *
 * Devuelve CLAVES del diccionario, no texto: traducir es de la capa que pinta,
 * como en el resto de domain/. */

export type SteamReviewLabel =
  | "steam: Overwhelmingly Positive"
  | "steam: Very Positive"
  | "steam: Positive"
  | "steam: Mostly Positive"
  | "steam: Mixed"
  | "steam: Mostly Negative"
  | "steam: Very Negative"
  | "steam: Overwhelmingly Negative"
  | "steam: Negative";

export interface SteamReviews {
  percent: number;
  count: number;
}

/** El umbral de "muchas reseñas" y el de "unas cuantas", los dos de Steam. */
const MUCHAS = 500;
const ALGUNAS = 50;

export function steamReviewLabel(r: SteamReviews | null | undefined): SteamReviewLabel | null {
  if (!r || r.count <= 0) return null;
  const { percent: p, count: n } = r;

  if (p >= 95 && n >= MUCHAS) return "steam: Overwhelmingly Positive";
  if (p >= 80 && n >= ALGUNAS) return "steam: Very Positive";
  if (p >= 80) return "steam: Positive";
  if (p >= 70) return "steam: Mostly Positive";
  if (p >= 40) return "steam: Mixed";
  if (p >= 20) return "steam: Mostly Negative";
  // Por debajo del 20% la escala vuelve a mirar cuántas son, en espejo del
  // extremo positivo: hundirse con ochocientas mil reseñas no es lo mismo que
  // hundirse con treinta.
  if (n >= MUCHAS) return "steam: Overwhelmingly Negative";
  if (n >= ALGUNAS) return "steam: Very Negative";
  return "steam: Negative";
}

/** El color con el que se pinta el porcentaje. Tres tramos y no nueve: la
 *  etiqueta ya dice el matiz, y nueve colores en una fila de notas serían un
 *  código que nadie se aprende.
 *
 *  Verde y rojo son los de siempre; el intermedio es el gris del texto y no un
 *  ámbar, porque "mixtas" no es un aviso, es un no-sé. */
export function steamReviewColor(percent: number): string {
  if (percent >= 70) return "var(--accent)";
  if (percent >= 40) return "var(--text-dim)";
  return "#e5484d";
}
