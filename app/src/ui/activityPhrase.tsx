import { Fragment } from "react";
import { watchedPhrase, type AddedList, type Medium } from "@/domain/mediumCopy";
import { t as tr } from "@/lib/i18n";

/* La frase de una fila de actividad: "vio S1 · E3–E7 de Severance", "añadiste
   386 juegos a tu biblioteca", "puntuó Dune".

   Vive aquí, y no dentro del muro del grupo donde nació, porque desde el perfil
   de tres medios hay DOS muros que la escriben —el de Explorar, que sirve
   `rpc_friend_activity`, y el del perfil, que se arma en el cliente
   (domain/activityWall)— y la elección de clave es la parte con esquinas:
   tercera persona o segunda, la lista que le toca a cada medio, el plural, y el
   hecho de que un juego no se ve sino que se termina. Dos copias de eso son dos
   copias que un día dirán cosas distintas.

   Lo que NO vive aquí son los verbos `started` / `finished_season`, que solo
   existen contra un RPC anterior a 0040 y solo los conoce el muro del grupo. */

/** Mete nodos de React en los {huecos} de una frase ya traducida.
 *
 *  La frase entera es UNA clave del diccionario, así que una lengua puede poner
 *  el nombre y el rango donde su gramática los quiera ("vio S1 · E3 de
 *  Severance"). Una cadena de fragmentos traducidos congelaría el orden
 *  inglés. */
export function fill(s: string, nodes: Record<string, React.ReactNode>): React.ReactNode {
  return s.split(/(\{[a-z]+\})/).map((part, i) => {
    const slot = /^\{[a-z]+\}$/.test(part) ? nodes[part.slice(1, -1)] : undefined;
    return <Fragment key={i}>{slot ?? part}</Fragment>;
  });
}

export interface PhraseInput {
  verb: "rated" | "added" | "watched";
  kind: Medium;
  /** El título, ya localizado y ya envuelto en lo que lo destaque. */
  name: React.ReactNode;
  /** Episodios vistos, o títulos añadidos. */
  count: number;
  /** El rango de episodios, ya compuesto. Solo en series: en cine y en juegos
   *  no hay rango, y el S1E1 sintético de 0067 y 0071 no es algo que nadie
   *  quiera leer. */
  episodes?: React.ReactNode;
  /** A qué lista fue lo añadido. La decide quien llama porque depende de la
   *  fila ("Lo tengo") y no solo del medio (domain/mediumCopy, `addedListOf`). */
  list?: AddedList;
  /** Tus propias filas necesitan sus claves, no las de tercera persona: el
   *  inglés se apaña con un verbo ("watched") y el español no ("vio"/"viste"). */
  isMe: boolean;
}

/* Los nombres de lista, en tabla: la lista que se invente mañana no compila
   hasta que diga con qué frase se cuenta. */
const ADDED_KEY: Record<AddedList, string> = {
  library: "added {name} to their library",
  backlog: "added {name} to their backlog",
  watchlist: "added {name} to their watchlist",
};
const ADDED_MANY_KEY: Record<AddedList, string> = {
  library: "added {count} {things} to their library",
  backlog: "added {count} {things} to their backlog",
  watchlist: "added {count} {things} to their watchlist",
};

const THINGS: Record<Medium, string> = { tv: "shows", movie: "movies", game: "games" };

const key = (k: string, isMe: boolean) => tr(isMe ? `self: ${k}` : k);

export function activityPhrase({ verb, kind, name, count, episodes, list = "watchlist", isMe }: PhraseInput): React.ReactNode {
  switch (verb) {
    case "rated":
      return fill(key("rated {name}", isMe), { name });

    case "added":
      /* Plegado (0077 en el muro del grupo, domain/activityWall en el del
         perfil). Una importación de Steam mete cuarenta juegos de golpe: sin
         esto son cuarenta filas idénticas que además borran del muro toda la
         actividad de verdad de esa persona.

         Y son dos ramas y no una frase con "1" dentro: "añadió 1 juego a su
         biblioteca" es lo que se escribe cuando a nadie le importa cómo suena. */
      return count > 1
        ? fill(key(ADDED_MANY_KEY[list], isMe), {
            count: <b style={{ fontWeight: 700 }}>{count}</b>,
            things: tr(THINGS[kind]),
          })
        : fill(key(ADDED_KEY[list], isMe), { name });

    case "watched":
      /* Una película se ve entera y de una vez, y un juego ni siquiera se ve:
         se termina. En los dos casos no hay un "S1·E1 de" que anteponerle. Cuál
         de las tres frases toca lo decide domain/mediumCopy, que es donde está
         probado; preguntarlo aquí a mano sería la cuarta copia de esa regla. */
      switch (watchedPhrase(kind)) {
        case "whole-title-finished":
          return fill(key("finished {name}", isMe), { name });
        case "whole-title":
          return fill(key("watched {name}", isMe), { name });
        default:
          // Sin rango —una serie cuyo episodio no llegó— se cuenta como entera
          // antes que imprimir "vio  de Severance" con el hueco vacío.
          return episodes
            ? fill(key("watched {eps} of {name}", isMe), { eps: episodes, name })
            : fill(key("watched {name}", isMe), { name });
      }
  }
}
