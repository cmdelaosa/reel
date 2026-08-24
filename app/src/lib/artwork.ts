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
