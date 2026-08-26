import type { Medium } from "@/domain/mediumCopy";
import { igdbImg } from "@/lib/igdb";
import { tmdbImg } from "@/lib/tmdb";

/* La carátula pequeña de una fila, en las listas donde conviven los tres
   medios: el muro de amigos, el historial y el buscador.

   Existe porque `titles.poster_path` NO guarda lo mismo en los tres (0071 lo
   documenta en la propia columna): TMDB guarda una RUTA ("/abc.jpg") y el
   tamaño va en el camino; IGDB guarda un HASH y el tamaño es un prefijo "t_".
   Pasarle un hash a tmdbImg da una URL bien formada que responde 404 sin
   quejarse en consola — o sea, filas de juegos sin carátula y ni un error que
   lo explique.

   Un solo tamaño a propósito: las tres listas que mezclan medios pintan la
   misma miniatura de ~90 px, y ofrecer aquí los seis tamaños de cada fuente
   sería inventar un diccionario de equivalencias que nadie ha comprobado.
   Quien pinta una carátula grande está dentro de un modo y sabe de qué medio
   es, así que llama directamente a tmdbImg o a igdbImg. */
export function thumbArt(kind: Medium, path: string | null | undefined): string | undefined {
  return kind === "game" ? igdbImg(path, "cover_small") : tmdbImg(path, "w92");
}

/** El cartel de una REJILLA en una lista mezclada: la biblioteca de un amigo,
 *  donde sus series, su cine y sus juegos se navegan en la misma parrilla.
 *
 *  Segundo par medido, y el párrafo de arriba explica por qué no contradice lo
 *  que dice: allí se rechaza inventar un diccionario de los seis tamaños de cada
 *  fuente sin comprobarlos; aquí hay UN hueco concreto —un cartel de ~160 px de
 *  ancho en pantalla, el doble en retina— y para ese hueco los dos escalones
 *  están medidos: `w342` de TMDB y `cover_big` de IGDB (264×374), que es lo más
 *  grande que IGDB da de una carátula.
 *
 *  Y hace falta porque la rejilla de la ficha de un amigo pasó a ser de los tres
 *  medios: pedía `tmdbImg` para todo, y a un hash de IGDB eso le devuelve una
 *  URL bien formada que responde 404 sin quejarse — la rejilla de sus juegos
 *  entera en blanco, sin un error que lo dijera. */
export function gridArt(kind: Medium, path: string | null | undefined): string | undefined {
  return kind === "game" ? igdbImg(path, "cover_big") : tmdbImg(path, "w342");
}

/* El banner de "Esta noche": la imagen apaisada, con la carátula de respaldo.
 *
 * Esto SÍ vive aquí, y el párrafo de arriba explica por qué parece una
 * contradicción y no lo es. Allí se rechaza un diccionario de los seis tamaños
 * de cada fuente, que sería inventar equivalencias sin comprobar. Aquí hay UN
 * hueco concreto —~1224 px de ancho, `object-fit: cover`— y para ese hueco las
 * equivalencias sí están medidas: w1280 y 1080p para el apaisado, w780 y
 * cover_big para el respaldo.
 *
 * Y hace falta tenerlo en un sitio porque la regla estaba escrita tres veces,
 * una por pantalla, y solo una era correcta: Series pedía el fotograma, Cine
 * copió la línea y se dejó el póster, Videojuegos copió y se dejó la carátula.
 * El resultado era un banner que enseñaba la franja del medio del dibujo
 * ampliada. La cuarta pantalla que quiera un banner ya no tiene de dónde
 * copiarlo mal.
 *
 * Los respaldos NO son el mismo tamaño que el apaisado a propósito: el póster
 * de TMDB no tiene rung `w1280` y devolvería un 404, y la carátula de IGDB no
 * gana nada pidiéndola en 1080p — no hay más píxeles que traer.
 */
export function heroArt(
  kind: Medium,
  backdropPath: string | null | undefined,
  posterPath: string | null | undefined,
): string | undefined {
  return kind === "game"
    ? (igdbImg(backdropPath, "1080p") ?? igdbImg(posterPath, "cover_big"))
    : (tmdbImg(backdropPath, "w1280") ?? tmdbImg(posterPath, "w780"));
}
