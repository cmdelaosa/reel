import { useState } from "react";
import { useSearchParams } from "react-router";
import { useGameLibrary, type LibraryGame } from "@/lib/library";
import type { GameStatus } from "@/domain/gameStatus";
import { formatPlaytime } from "@/domain/gameStatus";
import { t as tr, tv } from "@/lib/i18n";
import { igdbImg } from "@/lib/igdb";
import { Poster, TabMenu } from "@/ui";
import { PosterGridSkeleton } from "@/ui/Skeleton";

/* Tu biblioteca de juegos. Gemela de ShowsPage y de MoviesPage: la misma
   rejilla, los mismos chips y el mismo strip de orden, porque es la misma
   pregunta ("¿qué tengo?") en el tercer medio.

   Siete cubos, como series y a diferencia del cine, y no por simetría: un juego
   sí se deja a medias —es lo normal— y además hay uno que las otras dos no
   tienen. 'Sin final' es para el CS, el LoL o un PUBG: juegos que no acaban, y
   que en 'Jugando' se quedarían para siempre ensuciando la lista de lo que de
   verdad estás jugando ahora.

   Por defecto se abre en 'Jugando', que es la respuesta a la pregunta con la
   que uno abre esta pantalla. Cine abre en 'Sin empezar' porque allí la
   pregunta es qué ver esta noche; aquí es en qué estabas. */

type Bucket = GameStatus | "all";

const FILTERS: { key: Bucket; label: string }[] = [
  { key: "playing", label: "Playing" },
  { key: "backlog", label: "Backlog" },
  { key: "ongoing", label: "Ongoing" },
  { key: "finished", label: "Finished" },
  { key: "dropped", label: "Dropped" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All" },
];

type SortKey = "added" | "played" | "lastreleased" | "az" | "rating";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Date added" },
  { key: "played", label: "Most played" },
  { key: "lastreleased", label: "Last released" },
  { key: "az", label: "A–Z" },
  { key: "rating", label: "Top rated" },
];

const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
const COMPARATORS: Record<SortKey, (a: LibraryGame, b: LibraryGame) => number> = {
  added: (a, b) => ms(b.added_at) - ms(a.added_at),
  played: (a, b) => (b.minutes_played ?? 0) - (a.minutes_played ?? 0),
  lastreleased: (a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""),
  az: (a, b) => a.name.localeCompare(b.name),
  rating: (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
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

export default function GamesPage() {
  const { data: games = [], isPending } = useGameLibrary();
  const [sort, setSort] = useState<SortKey>("added");
  const [searchParams, setSearchParams] = useSearchParams();

  /* El cubo vive en la URL, igual que en las otras dos bibliotecas: la pestaña
     de la barra enlaza a un cubo concreto, y desde la propia página eso es una
     navegación a la misma ruta que un estado local ignoraría. */
  const param = searchParams.get("filter");
  const f: Bucket = FILTERS.some((x) => x.key === param) ? (param as Bucket) : "playing";
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
  const items = games.filter((g) => f === "all" || g.status === f).sort(COMPARATORS[sort]);

  const open = (igdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("game", String(igdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("My Games")}</h1>

      <div className="mq-toolbar">
        <div className="shows-buckets flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {tr(x.label)}
              <span className="mute" style={{ fontWeight: 700 }}>{count(x.key)}</span>
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
            <div key={s.key} className={`seg ${sort === s.key ? "seg-active" : ""}`} onClick={() => setSort(s.key)}>
              {tr(s.label)}
            </div>
          ))}
        </div>
        <TabMenu
          value={sort}
          options={SORTS.map((s) => ({ key: s.key, label: tr(s.label) }))}
          onPick={setSort}
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

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((g) => (
          <Poster
            key={g.title_id}
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
              progress:
                g.status === "playing" && g.progress != null ? Math.min(g.progress, 100) : undefined,
              stopped: g.status === "dropped",
            }}
            onClick={() => open(g.tmdb_id)}
          />
        ))}
      </div>
    </div>
  );
}
