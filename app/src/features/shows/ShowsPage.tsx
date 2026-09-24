import { memo, useState } from "react";
import { useSearchParams } from "react-router";
import { useLibrary, toTitleCard, type LibraryShow } from "@/lib/library";
import { useRatedAt } from "@/lib/ratings";
import type { ShowStatus } from "@/domain/status";
import { byRatedAt, type SortDir } from "@/domain/ratedSort";
import { byValue, flipDir } from "@/domain/librarySort";
import { externalScore } from "@/domain/externalScore";
import { t as tr, tv } from "@/lib/i18n";
import { fmtAirDate } from "@/lib/region";
import { EAGER_POSTERS, Poster, TabMenu, useGrowingList, useStableHandler } from "@/ui";
import { PosterGridSkeleton } from "@/ui/Skeleton";

/* My Shows — the library grid with status buckets. Port of prototype
   marquee.tsx → Shows, on live data. */

type Bucket = ShowStatus | "all" | "stopped";
const FILTERS: { key: Bucket; label: string }[] = [
  { key: "watching", label: "Watching" },
  { key: "caughtup", label: "Caught up" },
  { key: "watchlist", label: "Not started" },
  { key: "upcoming", label: "Upcoming" },
  { key: "finished", label: "Finished" },
  { key: "stopped", label: "Stopped" },
  { key: "all", label: "All" },
];

type SortKey = "lastwatched" | "lastreleased" | "az" | "rating" | "rated";

/* Las etiquetas son de UNA palabra, como en Juegos (0102) y por lo mismo: con
   «Último emitido» y «Última puntuada ↓» la fila no cabía y los cubos —que
   llevan `flex: 1`— se comían el déficit entero, así que «Abandonadas» y
   «Todas» se quedaban fuera sin barra que arrastrar. La otra mitad son los
   contadores, que ahora solo salen en el cubo puesto.

   `first` es el sentido en el que empieza cada orden: «A–Z» promete de la A a
   la Z y los otros cuatro «lo más reciente» o «lo mejor» primero. La flecha
   dice si estás en ese sentido (↓) o en el contrario (↑). */
const SORTS: { key: SortKey; label: string; first: SortDir }[] = [
  { key: "lastwatched", label: "Watched", first: "desc" },
  { key: "lastreleased", label: "Aired", first: "desc" },
  { key: "az", label: "A–Z", first: "asc" },
  { key: "rating", label: "Rating", first: "desc" },
  { key: "rated", label: "shows: Rated", first: "desc" },
];
/* "Watched" is the page's default everywhere except Not started, where by
   definition nothing has been watched: every row's key is null, so the order was
   whatever the rollup happened to return. What you want from a pile of shows you
   haven't begun is the newest one, so that bucket opens on Aired. Only a
   default — pick a sort and it holds while you move between buckets. */
const DEFAULT_SORT: Partial<Record<Bucket, SortKey>> = { watchlist: "lastreleased" };
const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
/* «Puntuada» no está aquí: es el único orden que no se lee de la fila de la
   biblioteca sino de tus notas, que son otra tabla — ver domain/ratedSort.

   Los otros cuatro son `byValue` y no una resta suelta, y el `null` es el
   motivo: desde que los órdenes se voltean, una serie sin empezar o sin nota
   NO puede ordenarse como un 0, o encabezaría «de menos a más» con todo lo
   que la biblioteca no sabe. `null` la manda al final en los dos sentidos
   (domain/librarySort); `externalScore` ya lo devuelve para una nota a 0. */
const COMPARATORS: Record<Exclude<SortKey, "rated">, (dir: SortDir) => (a: LibraryShow, b: LibraryShow) => number> = {
  lastwatched: (dir) => byValue((s) => ms(s.last_watched_at) || null, dir),
  lastreleased: (dir) => byValue((s) => ms(s.last_aired_datetime) || null, dir),
  az: (dir) => byValue((s) => s.name, dir),
  /* Por la nota que la carátula enseña —IMDb, o TMDB de reserva— y no por la
     de TMDB a secas: ordenar por un número y pintar otro haría que la rejilla
     pareciera desordenada. */
  rating: (dir) => byValue((s) => externalScore(s)?.value ?? null, dir),
};

/* Memoizada: con la rejilla por tandas, cada tanda nueva vuelve a pintar la
   página, y sin esto re-renderizaba todas las carátulas ya montadas. La fila
   de la biblioteca conserva su identidad mientras no lleguen datos nuevos, y
   `onOpen` es estable (useStableHandler). */
const ShowCard = memo(function ShowCard({ s, priority, onOpen }: {
  s: LibraryShow;
  priority: boolean;
  onOpen: (tmdbId: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Poster t={toTitleCard(s)} priority={priority} prefetchTmdbId={s.tmdb_id} onClick={() => onOpen(s.tmdb_id)} />
      {s.status === "caughtup" && s.next_air_datetime && (
        <div className="mute" style={{ fontSize: 11.5, paddingLeft: 2 }}>
          ⏳ {tr("Next episode")} {fmtAirDate(s.next_air_datetime)}
        </div>
      )}
    </div>
  );
});

export default function ShowsPage() {
  const { data: library = [], isPending } = useLibrary();
  /* Null until you touch the sort strip; until then the bucket chooses.
     Pulsar el orden que YA está puesto lo voltea, y eso vale para los cinco,
     igual que en Juegos. Cambiar de orden reinicia el sentido al natural de la
     etiqueta: llegar a «A–Z» y encontrarlo de la Z a la A porque antes
     volteaste «Visto» no lo espera nadie. */
  const [sortPick, setSortPick] = useState<{ key: SortKey; flipped: boolean } | null>(null);
  const ratedAt = useRatedAt();
  const [searchParams, setSearchParams] = useSearchParams();

  /* The bucket lives in the URL, not in state: the Watchlist tab links straight
     to ?filter=watchlist, and from /shows itself that's a same-route navigation
     — local state would simply ignore it. Unknown or absent falls back to
     Watching, the bucket this page has always opened on.
     Picking a chip replaces the entry rather than pushing one: filtering isn't
     navigation, and Back should leave the page, not walk back through six
     buckets. */
  const param = searchParams.get("filter");
  const f: Bucket = FILTERS.some((x) => x.key === param) ? (param as Bucket) : "watching";
  const setF = (key: Bucket) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", key);
        return next;
      },
      { replace: true },
    );
  const sort: SortKey = sortPick?.key ?? DEFAULT_SORT[f] ?? "lastwatched";
  const flipped = sortPick?.flipped ?? false;
  /* Voltear el orden por omisión del cubo también cuenta como elegirlo: desde
     ahí se queda puesto al pasar de un cubo a otro, como cualquier otro. */
  const pickSort = (key: SortKey) => setSortPick({ key, flipped: key === sort ? !flipped : false });
  const natural = SORTS.find((s) => s.key === sort)?.first ?? "desc";
  const dir: SortDir = flipped ? flipDir(natural) : natural;
  /* La flecha solo en el orden puesto: en los otros no diría nada y costaba su
     ancho en la fila que justamente no cabía. */
  const sortLabel = (s: { key: SortKey; label: string }) =>
    s.key === sort ? `${tr(s.label)} ${flipped ? "↑" : "↓"}` : tr(s.label);

  // All includes every follow (stopped too); the status buckets show active
  // follows only, and Stopped collects the stopped ones.
  const inBucket = (s: LibraryShow) => {
    if (f === "all") return true;
    if (f === "stopped") return s.stopped;
    if (s.stopped) return false;
    return s.status === f;
  };
  const count = (key: Bucket) =>
    key === "all"
      ? library.length
      : key === "stopped"
        ? library.filter((s) => s.stopped).length
        : library.filter((s) => !s.stopped && s.status === key).length;
  const items = library.filter(inBucket).sort(sort === "rated" ? byRatedAt(ratedAt, dir) : COMPARATORS[sort](dir));
  /* Se monta por tandas (ui/GrowingList): los contadores y el orden de arriba
     siguen siendo de la lista entera; solo se recorta lo que se pinta. El
     sentido va en la clave porque voltear reordena la rejilla entera. */
  const { shown, sentinel } = useGrowingList(items, `${f}|${sort}|${dir}`);

  const open = useStableHandler((tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    }),
  );

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("My Shows")}</h1>

      <div className="mq-toolbar">
        {/* El contador, solo en el cubo puesto, como en Juegos: los otros seis
            son cifras de listas que no tienes delante. En el menú del móvil
            siguen los siete, que ahí sobra sitio. Y en `dim`, no `mute`: el
            gris apagado da 2,71:1 sobre el fondo de .chip-active. */}
        <div className="shows-buckets flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {tr(x.label)}
              {f === x.key && <span className="dim" style={{ fontWeight: 700 }}>{count(x.key)}</span>}
            </button>
          ))}
        </div>
        {/* Same options on a phone, as a menu — the chip row scrolled seven wide
            and showed two. Counts ride along as hints: the menu still shows all
            seven, while the row only shows the active one. */}
        <TabMenu
          value={f}
          options={FILTERS.map((x) => ({ key: x.key, label: tr(x.label), hint: String(count(x.key)) }))}
          onPick={setF}
          menuLabel={tr("My Shows")}
        />
        <div className="segmented scroll no-scrollbar">
          {SORTS.map((s) => (
            <div key={s.key} className={`seg ${sort === s.key ? "seg-active" : ""}`} onClick={() => pickSort(s.key)}>
              {sortLabel(s)}
            </div>
          ))}
        </div>
        {/* Phone shape of the same strip — "Mejor nota" showed 58 of its 95px at
            360px, with nothing saying a fourth sort existed. */}
        <TabMenu
          value={sort}
          options={SORTS.map((s) => ({ key: s.key, label: sortLabel(s) }))}
          onPick={pickSort}
          menuLabel={tr("Sort")}
          align="end"
        />
      </div>

      {f === "caughtup" && (
        <p className="dim" style={{ fontSize: 13.5, margin: "-8px 0 0" }}>
          {tr("Watched everything that's aired — just waiting on the next season.")}
        </p>
      )}

      {isPending && <PosterGridSkeleton />}

      {!isPending && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {/* One key for the sentence; the ⌘K chip is slotted back wherever
                the translation puts {key}, so it isn't pinned to English order. */}
            {f === "all"
              ? tr("Nothing here yet — hit {key} and add a show.")
                  .split("{key}")
                  .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))
              : tv("Nothing in {filter} right now.", { filter: tr(FILTERS.find((x) => x.key === f)?.label ?? "") })}
          </p>
        </div>
      )}

      <div className="poster-grid">
        {shown.map((s, i) => (
          <ShowCard key={s.title_id} s={s} priority={i < EAGER_POSTERS} onOpen={open} />
        ))}
      </div>
      {sentinel}
    </div>
  );
}
