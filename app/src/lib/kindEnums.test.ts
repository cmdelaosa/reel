import { describe, expect, it } from "vitest";
import ratingsSource from "@/lib/ratings.ts?raw";
import tasteSource from "@/lib/taste.ts?raw";
import friendProfileSource from "@/lib/friendProfile.ts?raw";

/* La avería que este fichero vigila no se ve leyendo la pantalla rota, y por eso
   se prueba sobre el CÓDIGO FUENTE y no sobre una función.

   `titles.kind` acepta tres valores desde 0071. Estos tres módulos leen filas de
   `ratings` / `library_entries` / `watch_events` SIN filtrar por medio en SQL,
   así que reciben los tres. Un `z.enum(["tv", "movie"])` ahí no ignora la fila
   de un juego: zod tira el parseo ENTERO, la consulta falla, y con ella se caen
   a la vez la afinidad de gustos, las estadísticas del grupo, la ficha de un
   amigo y la lista de puntuadas de tu perfil — sin más rastro que un error en
   la consola. Basta con que una sola nota, tuya o de un amigo, sea de un juego:
   la importación de InfiniteBacklog escribe cientos de golpe.

   Se comprueban las tres lecturas juntas porque el fallo es de las tres a la
   vez: arreglar una y dejar otra deja la pantalla igual de rota.

   lib/providers.ts se queda fuera a propósito: su consulta lleva
   `.eq("kind", kind)`, así que solo puede recibir de vuelta el medio que pidió.

   Cargado con `?raw` como los mirror tests: no hace falta @types/node en el
   tsconfig de la app, y si un fichero se mueve, esto falla al importarlo. */

const SOURCES: Record<string, string> = {
  "lib/ratings.ts": ratingsSource,
  "lib/taste.ts": tasteSource,
  "lib/friendProfile.ts": friendProfileSource,
};

/** Cada `z.enum([...])` del fichero que enumere medios. */
function mediumEnums(source: string): string[] {
  return [...source.matchAll(/z\.enum\(\[[^\]]*\]\)/g)]
    .map((m) => m[0])
    .filter((e) => e.includes('"tv"'));
}

describe("los medios que aceptan las lecturas de notas", () => {
  it.each(Object.keys(SOURCES))("%s enumera los tres en cada z.enum de kind", (file) => {
    const enums = mediumEnums(SOURCES[file]);
    expect(enums.length).toBeGreaterThan(0);
    for (const e of enums) {
      expect(e, `${file}: ${e} deja fuera un medio`).toContain('"movie"');
      expect(e, `${file}: ${e} deja fuera un medio`).toContain('"game"');
    }
  });
});
