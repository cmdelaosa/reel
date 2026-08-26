/* El "taste profile" de una biblioteca: de qué van tus series, tu cine y tus
   juegos. Puro, con pruebas al lado (tasteProfile.test.ts).

   Un bloque POR MEDIO y no uno solo con todo dentro, por lo mismo que la
   afinidad son tres y no una (domain/tasteScope): "Animación · 40" mezclando
   los animes que sigues, las de Pixar y los Mario no describe a nadie. Y
   porque la segunda fila de cada bloque no es la misma cosa en los tres:

     · series → la CADENA (Netflix, HBO), que es de quién es lo que ves.
     · cine   → la DÉCADA, porque una filmoteca se describe por épocas y la
                columna `network` de una película trae la productora, que no es
                algo que nadie reconozca de un vistazo.
     · juegos → la PLATAFORMA, que es lo que un jugador contesta si le
                preguntas de qué van sus juegos.

   Las tres salen de datos que la biblioteca YA trae: `network` desde el primer
   día, `first_air_date` también, y `platforms` viaja en `rpc_library_rollup`
   desde 0071 aunque hasta ahora no lo leyera nadie. */

export type Medium = "tv" | "movie" | "game";

/** Qué son los chips de la segunda fila de un bloque. La capa que pinta lo
 *  necesita para escribir "los 90" y no "90": traducir es suyo, no de aquí. */
export type ChipKind = "network" | "decade" | "platform";

export interface TasteEntry {
  /** El nombre crudo. En las décadas, el año en que empieza ("1990"). */
  name: string;
  count: number;
}

export interface TasteBlock {
  medium: Medium;
  /** Cuántos títulos de ese medio hay detrás. */
  titles: number;
  /** De más a menos. Sin recortar: quien pinta decide cuántas barras caben. */
  genres: TasteEntry[];
  chipKind: ChipKind;
  /** Los cinco de arriba, que es lo que cabe en una fila de chips. */
  chips: TasteEntry[];
}

/** Lo mínimo que hace falta saber de un título para colocarlo. Lo cumplen tanto
 *  las filas de tu biblioteca (`LibraryRow`) como las de un amigo
 *  (`FriendFollow`), que es el punto: los dos perfiles pintan el mismo bloque. */
export interface TasteInput {
  kind: Medium;
  genres: readonly string[];
  network?: string | null;
  first_air_date?: string | null;
  platforms?: readonly string[] | null;
}

const ORDER: readonly Medium[] = ["tv", "movie", "game"];

/* Tabla y no ternarios, la regla de domain/tasteScope: el medio que llegue el
   año que viene no compila hasta que alguien diga con qué se describe, en vez
   de heredar en silencio las cadenas de las series. */
const CHIP_KIND: Record<Medium, ChipKind> = { tv: "network", movie: "decade", game: "platform" };

/** De qué van los títulos de UNA fila, según su medio. Devuelve los nombres
 *  crudos; contarlos es de abajo. */
function chipsOf(row: TasteInput): string[] {
  switch (CHIP_KIND[row.kind]) {
    case "network":
      return row.network ? [row.network] : [];
    case "decade": {
      const year = Number(row.first_air_date?.slice(0, 4));
      // Un estreno sin fecha no inventa década: `Number("")` es 0 y `NaN` es lo
      // que devuelve una fecha rara, y las dos habrían fabricado "los 0".
      return Number.isFinite(year) && year > 1800 ? [String(Math.floor(year / 10) * 10)] : [];
    }
    case "platform":
      // Un juego está en varias, y cuenta en todas: es lo mismo que hace el
      // filtro "solo Switch" del catálogo, y decir que un multiplataforma es de
      // una sola sería elegir por la persona cuál.
      return row.platforms ? [...row.platforms] : [];
  }
}

const tally = (into: Map<string, number>, names: readonly string[]) => {
  for (const n of names) into.set(n, (into.get(n) ?? 0) + 1);
};

/* Empate por nombre y no por el orden de llegada, por lo mismo que en el
   heatmap: dos géneros con el mismo recuento tienen que salir siempre en el
   mismo orden o la lista baila entre cargas de los mismos datos. */
const byCount = (a: TasteEntry, b: TasteEntry) => b.count - a.count || a.name.localeCompare(b.name);

/** Un bloque por medio con algo dentro, en el orden canónico de la app.
 *
 *  Los medios vacíos NO salen: a quien solo ve series, un bloque de juegos
 *  permanentemente en blanco le dice menos que nada — es la misma regla que ya
 *  siguen las estadísticas de tu perfil, que solo pintan cine y juegos si
 *  tienes algo. */
export function tasteBlocks(rows: readonly TasteInput[]): TasteBlock[] {
  const acc = new Map<Medium, { titles: number; genres: Map<string, number>; chips: Map<string, number> }>();
  for (const row of rows) {
    const bucket = acc.get(row.kind) ?? { titles: 0, genres: new Map(), chips: new Map() };
    bucket.titles += 1;
    tally(bucket.genres, row.genres);
    tally(bucket.chips, chipsOf(row));
    acc.set(row.kind, bucket);
  }

  return ORDER.flatMap((medium): TasteBlock[] => {
    const bucket = acc.get(medium);
    if (!bucket) return [];
    const entries = (m: Map<string, number>) =>
      [...m.entries()].map(([name, count]) => ({ name, count })).sort(byCount);
    return [{
      medium,
      titles: bucket.titles,
      genres: entries(bucket.genres),
      chipKind: CHIP_KIND[medium],
      chips: entries(bucket.chips).slice(0, 5),
    }];
  });
}
