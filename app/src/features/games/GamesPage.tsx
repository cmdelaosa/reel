import { memo, useState } from "react";
import { useSearchParams } from "react-router";
import { useGameLibrary, type LibraryGame } from "@/lib/library";
import { useRatedAt } from "@/lib/ratings";
import type { GameStatus } from "@/domain/gameStatus";
import { formatPlaytime } from "@/domain/gameStatus";
import { byRatedAt, type SortDir } from "@/domain/ratedSort";
import { byValue, flipDir } from "@/domain/librarySort";
import { bySteamReviews } from "@/domain/steamReviews";
import { t as tr, tv } from "@/lib/i18n";
import { igdbImg } from "@/lib/igdb";
import { EAGER_POSTERS, Poster, TabMenu, useGrowingList, useStableHandler } from "@/ui";
import { PosterGridSkeleton } from "@/ui/Skeleton";

/* Tu biblioteca de juegos. Gemela de ShowsPage y de MoviesPage: la misma
   rejilla, los mismos chips y el mismo strip de orden, porque es la misma
   pregunta ("¿qué tengo?") en el tercer medio.

   Siete cubos, como series y a diferencia del cine, y no por simetría: un juego
   sí se deja a medias —es lo normal— y además hay uno que las otras dos no
   tienen. 'Sin final' es para el CS, el LoL o un PUBG: juegos que no acaban, y
   que en 'Jugando' se quedarían para siempre ensuciando la lista de lo que de
   verdad estás jugando ahora.

   Abre en 'Pendientes', y hasta hoy abría en 'Jugando'. El cambio es porque la
   pantalla cambió de papel: mientras fue lo único que había, era la portada del
   modo y tenía que responder "¿en qué estaba?". Eso lo responde ahora el héroe
   de Esta noche, y aquí se viene a lo otro — a elegir de lo que tienes por
   jugar. Es también lo que hace que la pestaña y el cubo digan la misma
   palabra, que es la razón por la que la pestaña se llama Pendientes. */

type Bucket = GameStatus | "all";

/* Tres de los siete llevan clave propia y no la compartida con Series: en
   español «Finished», «Upcoming» y «All» dicen «Terminadas», «Próximas» y
   «Todas», que hablan de un juego en femenino. Las otras cuatro ya son de
   aquí. El porqué entero, y por qué el prefijo es tan largo, en lib/i18n. */
const FILTERS: { key: Bucket; label: string }[] = [
  { key: "playing", label: "Playing" },
  { key: "backlog", label: "Backlog" },
  { key: "ongoing", label: "Ongoing" },
  { key: "finished", label: "games bucket: Finished" },
  { key: "dropped", label: "Dropped" },
  { key: "upcoming", label: "games bucket: Upcoming" },
  { key: "all", label: "games bucket: All" },
];

type SortKey = "added" | "hours" | "released" | "az" | "rating" | "steam" | "rated";

/* Las etiquetas son de UNA palabra, y esa es la mitad del arreglo de 0102:
   con «Date added», «Most played» y «Best on Steam» la fila entera pedía 1.402
   px y la columna da 1.224, así que los cubos —que llevan `flex: 1`— se comían
   el déficit entero y perdían tres por el borde, sin barra que arrastrar. La
   otra media son los contadores, que ahora solo salen en el cubo puesto.

   `first` es el sentido en el que empieza cada orden, y es lenguaje de la
   etiqueta más que de los datos: «A–Z» promete de la A a la Z y los otros seis
   prometen «lo más» primero. La flecha dice si estás en ese sentido (↓) o en el
   contrario (↑), no si el valor sube o baja — ver `natural` y `dir` más abajo. */
const SORTS: { key: SortKey; label: string; first: SortDir }[] = [
  { key: "added", label: "games: Added", first: "desc" },
  { key: "hours", label: "Hours", first: "desc" },
  { key: "released", label: "Released", first: "desc" },
  { key: "az", label: "A–Z", first: "asc" },
  { key: "rating", label: "Rating", first: "desc" },
  /* Junto a «Nota» y no en su lugar: esa es la de IGDB y esta la de quien se lo
     ha jugado, que es la que la carátula enseña con el logotipo. Las dos
     ordenan la misma rejilla por dos criterios que no coinciden. */
  { key: "steam", label: "Steam", first: "desc" },
  { key: "rated", label: "games: Rated", first: "desc" },
];

const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
/* «Puntuado» no está aquí: es el único orden que no se lee de la fila de la
   biblioteca sino de tus notas, que son otra tabla — ver domain/ratedSort.

   Los otros seis son `byValue` y no una resta suelta, y el `|| null` de tres de
   ellos es el motivo: desde que los órdenes se voltean, un juego sin nota de
   IGDB o sin fecha de salida NO puede ordenarse como un 0, o encabezaría «de
   menos a más» con doscientos juegos de los que no se sabe nada. `null` los
   manda al final en los dos sentidos (domain/librarySort). Los minutos van sin
   `|| null` a propósito: ahí el 0 es el dato, «no lo he tocado».

   El de `added` además atrapa el NaN de una fecha ilegible, que es lo que
   devuelve `ms`; la cara de que trate el epoch como un hueco no llega a pasar
   —`added_at` lo escribe la propia app con un `new Date()`—. */
const COMPARATORS: Record<Exclude<SortKey, "rated">, (dir: SortDir) => (a: LibraryGame, b: LibraryGame) => number> = {
  added: (dir) => byValue((g) => ms(g.added_at) || null, dir),
  hours: (dir) => byValue((g) => g.minutes_played ?? 0, dir),
  released: (dir) => byValue((g) => g.first_air_date || null, dir),
  az: (dir) => byValue((g) => g.name, dir),
  rating: (dir) => byValue((g) => g.vote_average || null, dir),
  /* Lo que no está en Steam va al final y no al fondo del porcentaje, tampoco
     volteado; la regla entera, con sus desempates, en domain/steamReviews. */
  steam: (dir) => bySteamReviews(dir),
};

/* Lo que va debajo del nombre en la tarjeta. Las horas cuando las hay, porque
   es lo que distingue un juego de otro en esta rejilla; si no, la plataforma,
   que es lo siguiente que uno mira. Un juego sin empezar y sin plataformas no
   lleva nada: mejor vacío que un guion. */
function subtitleOf(g: LibraryGame): string | undefined {
  if ((g.minutes_played ?? 0) > 0) return formatPlaytime(g.minutes_played ?? 0);
  const platforms = g.platforms ?? [];
  if (!platforms.length) return undefined;
  return platforms.length > 2 ? `${platforms[0]} +${platforms.length - 1}` : platforms.join(" · ");
}

/* Memoizada, como la de ShowsPage: sin esto cada tanda nueva de la rejilla
   re-renderizaba todas las carátulas ya montadas. */
const GameCard = memo(function GameCard({ g, priority, onOpen }: {
  g: LibraryGame;
  priority: boolean;
  onOpen: (igdbId: number) => void;
}) {
  return (
    <Poster
      priority={priority}
      /* El medio, explícito. Es lo que deja salir el porcentaje de Steam, y de
         paso arregla algo que estaba mal sin verse: con el defecto ('tv') el
         nombre del juego pasaba por el mapa de títulos en español, que se
         indexa por `kind:id` — o sea buscaba `tv:<id de IGDB>` y podía
         ponerle a un juego el título de la serie que lleva ese número. */
      kind="game"
      /* Sin proveedores: un juego no está "en Netflix". Lo que ocupa ese
         hueco mental son las plataformas, y van en el subtítulo. */
      showProviders={false}
      subtitle={subtitleOf(g)}
      t={{
        id: String(g.tmdb_id),
        name: g.name,
        year: g.first_air_date?.slice(0, 4) ?? "TBA",
        genres: g.genres.length ? g.genres : ["—"],
        posterPath: igdbImg(g.poster_path),
        voteAverage: g.vote_average ?? 0,
        steamReviews: g.steam_reviews,
        progress:
          g.status === "playing" && g.progress != null ? Math.min(g.progress, 100) : undefined,
        stopped: g.status === "dropped",
      }}
      onClick={() => onOpen(g.tmdb_id)}
    />
  );
});

export default function GamesPage() {
  const { data: games = [], isPending } = useGameLibrary();
  /* Pulsar el orden que YA está puesto lo voltea, y eso vale para los siete —en
     Series y Cine solo lo hace «Última puntuada» (lib/ratings, useRatedSort).
     Por eso esta página no usa aquel gancho: el sentido es uno solo y vive
     aquí, y tenerlo además dentro de useRatedSort daría dos estados que se
     contradicen en cuanto cambias de orden y vuelves.

     Cambiar de orden reinicia el sentido al natural de la etiqueta en vez de
     arrastrar el anterior: llegar a «A–Z» y encontrarlo de la Z a la A porque
     antes volteaste «Horas» no lo espera nadie. */
  const [sort, setSort] = useState<{ key: SortKey; flipped: boolean }>({ key: "added", flipped: false });
  const [searchParams, setSearchParams] = useSearchParams();
  const ratedAt = useRatedAt();
  const pickSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, flipped: !prev.flipped } : { key, flipped: false }));
  const natural = (key: SortKey) => SORTS.find((s) => s.key === key)?.first ?? "desc";
  const dir: SortDir = sort.flipped ? flipDir(natural(sort.key)) : natural(sort.key);
  /* La flecha solo en el orden puesto: en los otros seis no diría nada —no hay
     un sentido que enseñar de algo que no está ordenando— y costaba seis veces
     su ancho en la fila que justamente no cabía. */
  const sortLabel = (s: { key: SortKey; label: string }) =>
    s.key === sort.key ? `${tr(s.label)} ${sort.flipped ? "↑" : "↓"}` : tr(s.label);

  /* El cubo vive en la URL, igual que en las otras dos bibliotecas: la pestaña
     de la barra enlaza a un cubo concreto, y desde la propia página eso es una
     navegación a la misma ruta que un estado local ignoraría. */
  const param = searchParams.get("filter");
  const f: Bucket = FILTERS.some((x) => x.key === param) ? (param as Bucket) : "backlog";
  const setF = (key: Bucket) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", key);
        return next;
      },
      { replace: true },
    );

  const count = (key: Bucket) =>
    key === "all" ? games.length : games.filter((g) => g.status === key).length;
  const items = games
    .filter((g) => f === "all" || g.status === f)
    .sort(sort.key === "rated" ? byRatedAt(ratedAt, dir) : COMPARATORS[sort.key](dir));
  /* Se monta por tandas (ui/GrowingList): los contadores y el orden de arriba
     siguen siendo de la lista entera; solo se recorta lo que se pinta. El
     sentido va en la clave porque voltear reordena la rejilla entera y la tanda
     ya montada dejaría arriba lo que acaba de irse al fondo. */
  const { shown, sentinel } = useGrowingList(items, `${f}|${sort.key}|${dir}`);

  const open = useStableHandler((igdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("game", String(igdbId));
      return next;
    }),
  );

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("My Games")}</h1>

      <div className="mq-toolbar">
        {/* El contador, solo en el cubo puesto. Siete contadores son ~90 px de
            los que faltaban, y de los siete solo uno responde a algo que estés
            mirando: los otros seis son cifras de listas que no tienes delante.
            En el menú del móvil siguen los siete, que ahí sobra sitio.

            Y `dim` en vez de `mute`, que es lo que llevaba: el gris apagado da
            2,71:1 sobre el fondo teñido de .chip-active —suspende de sobra— y
            antes se le perdonaba a medias porque había otros seis contadores
            sobre el fondo neutro. Ahora el único que se pinta es justo ese.
            `dim` sube a 5,61:1 sin cambiar de familia de grises. */}
        <div className="shows-buckets flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {tr(x.label)}
              {f === x.key && <span className="dim" style={{ fontWeight: 700 }}>{count(x.key)}</span>}
            </button>
          ))}
        </div>
        <TabMenu
          value={f}
          options={FILTERS.map((x) => ({ key: x.key, label: tr(x.label), hint: String(count(x.key)) }))}
          onPick={setF}
          menuLabel={tr("My Games")}
        />
        <div className="segmented scroll no-scrollbar">
          {SORTS.map((s) => (
            <div key={s.key} className={`seg ${sort.key === s.key ? "seg-active" : ""}`} onClick={() => pickSort(s.key)}>
              {sortLabel(s)}
            </div>
          ))}
        </div>
        <TabMenu
          value={sort.key}
          options={SORTS.map((s) => ({ key: s.key, label: sortLabel(s) }))}
          onPick={pickSort}
          menuLabel={tr("Sort")}
          align="end"
        />
      </div>

      {isPending && <PosterGridSkeleton />}

      {!isPending && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {f === "all"
              ? tr("No games yet — hit {key} and add one.")
                  .split("{key}")
                  .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))
              : tv("Nothing in {filter} right now.", { filter: tr(FILTERS.find((x) => x.key === f)?.label ?? "") })}
          </p>
        </div>
      )}

      <div className="poster-grid">
        {shown.map((g, i) => (
          <GameCard key={g.title_id} g={g} priority={i < EAGER_POSTERS} onOpen={open} />
        ))}
      </div>
      {sentinel}
    </div>
  );
}
