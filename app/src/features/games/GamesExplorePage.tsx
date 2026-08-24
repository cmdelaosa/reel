import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { X } from "lucide-react";
import { igdbImg, useGamePool, type GamePool } from "@/lib/igdb";
import { useGameLibrary } from "@/lib/library";
import { useIgnored } from "@/lib/ignore";
import { t as tr } from "@/lib/i18n";
import { Poster, Rail, TabMenu, useShowMore } from "@/ui";
import { PosterGridSkeleton, RailCardsSkeleton } from "@/ui/Skeleton";
import type { TitleRow } from "@/lib/schemas";

/* Explorar, en juegos. La tercera con esta planta —un carrusel arriba y una
   rejilla con pestañas debajo— y la que más se separa de las otras dos en QUÉ
   pregunta, porque un catálogo de juegos responde otras cosas.

   ── El carrusel de arriba es expectativa, no tendencia ────────────────────
   En series y cine, arriba van las tendencias de la semana. IGDB no publica
   nada parecido a "lo que la gente está viendo ahora": lo que sí publica es
   `hypes`, cuánta gente sigue un juego que TODAVÍA NO HA SALIDO. Y resulta ser
   la pregunta que más se hace de los videojuegos y la que ninguna de las otras
   dos pantallas puede hacer — el cine y las series se estrenan y ya, mientras
   que un juego se espera durante años. De ahí "Más esperados".

   ── El filtro es la plataforma, y no el género ni el año ──────────────────
   Las otras dos filtran por género y por década. Aquí la primera pregunta es
   otra: "¿sale en la mía?". Un juego que no llega a tu consola no es un juego
   que puedas jugar, y eso no tiene equivalente en cine — una película se ve en
   cualquier pantalla. 0071 guardó `platforms` como nombres (no ids) y hasta le
   puso su índice GIN por esto mismo.

   Se filtra en el cliente y no en la consulta, a diferencia de los géneros de
   "Mejor valoradas" en cine. El motivo es concreto: filtrar en IGDB exige
   mandar IDS de plataforma, y los ids de IGDB son justo lo que esta rama ha
   aprendido a no dar por sabido (ver la cabecera de normalize.ts sobre los
   formatos de fecha, que la documentación tenía mal). Comparando NOMBRES contra
   lo que la propia respuesta trajo, un nombre equivocado no hace nada — el chip
   no casa con nada y se ve — mientras que un id equivocado devolvería otra
   plataforma sin decirlo.

   No hay filtro de año a propósito: en series y cine acota un catálogo de
   décadas, y en juegos la pregunta "¿de qué año es?" no la hace casi nadie
   antes de mirar la ficha. */

type Tab = Exclude<GamePool, "anticipated">;
const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "New releases" },
  { key: "popular", label: "Popular" },
  { key: "top-rated", label: "Top rated" },
];

const PAGE_SIZE = 18;

/* Cuántas plataformas se ofrecen como chip. Salen de lo que hay en la rejilla,
   no de una lista escrita a mano: IGDB tiene doscientas plataformas —incluida
   la Amstrad CPC— y una lista fija envejecería sola, además de ofrecer filtros
   que no dejarían nada. Las que más aparecen son las que alguien va a pulsar. */
const PLATFORM_CHIPS = 8;

function topPlatforms(rows: readonly TitleRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.platforms ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PLATFORM_CHIPS)
    .map(([name]) => name);
}

/* Lo que va debajo del nombre. Las plataformas, y no el año como en los otros
   dos medios: las filas de una rejilla de descubrimiento se guardan PARCIALES
   —sin fechas— a propósito (ver gameSearchRow), porque el timestamp que IGDB da
   en una consulta de catálogo no viene con su precisión, y escribirlo sería
   afirmar un día que la fuente no ha prometido. Las plataformas sí vienen, y
   son además lo que uno mira de un juego que no conoce. */
function subtitleOf(t: TitleRow): string | undefined {
  const platforms = t.platforms ?? [];
  if (!platforms.length) return undefined;
  return platforms.length > 2 ? `${platforms[0]} +${platforms.length - 1}` : platforms.join(" · ");
}

export default function GamesExplorePage() {
  const [, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("new");
  const [platforms, setPlatforms] = useState<string[]>([]);

  const anticipated = useGamePool("anticipated");
  // Una consulta por pestaña, y solo la de la pestaña abierta.
  const pool = useGamePool(tab);

  const { data: mine = [] } = useGameLibrary();
  const { isIgnored } = useIgnored();
  const followed = useMemo(() => new Set(mine.map((g) => g.tmdb_id)), [mine]);

  const poolData = pool.data;
  /* Las elegidas van SIEMPRE, aunque no estén entre las más frecuentes de esta
     rejilla. Sin eso, filtrar por Xbox 360 en Populares y pasar a Novedades
     —donde esa plataforma no entra en las ocho— dejaba la rejilla vacía con un
     filtro puesto y ningún chip encendido que quitar: sin salida salvo recargar.
     Delante, además, para que se vea que siguen puestas. */
  const chips = useMemo(
    () => [...new Set([...platforms, ...topPlatforms(poolData ?? [])])],
    [poolData, platforms],
  );

  const items = useMemo(
    () =>
      (poolData ?? [])
        .filter((t) => !followed.has(t.tmdb_id) && !isIgnored(t.tmdb_id))
        .filter((t) => platforms.length === 0 || (t.platforms ?? []).some((p) => platforms.includes(p))),
    [poolData, followed, isIgnored, platforms],
  );

  const { shown, more } = useShowMore(items, PAGE_SIZE);

  const open = (igdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("game", String(igdbId));
      return next;
    });

  const toggle = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const card = (t: TitleRow, rank?: number) => (
    <Poster
      key={t.tmdb_id}
      kind="game"
      showProviders={false}
      subtitle={subtitleOf(t)}
      rank={rank}
      t={{
        id: String(t.tmdb_id),
        name: t.name,
        year: t.first_air_date?.slice(0, 4) ?? "TBA",
        genres: t.genres.length ? t.genres : ["—"],
        posterPath: igdbImg(t.poster_path),
        voteAverage: t.vote_average ?? 0,
      }}
      onClick={() => open(t.tmdb_id)}
    />
  );

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Explore")}</h1>

      {(anticipated.isLoading || (anticipated.data?.length ?? 0) > 0) && (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Most anticipated")}>
            {anticipated.isLoading
              ? <RailCardsSkeleton count={8} />
              : (anticipated.data ?? []).map((t, i) => (
                  <div key={t.tmdb_id} style={{ width: "var(--rail-pw)" }}>{card(t, i + 1)}</div>
                ))}
          </Rail>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="disc-toolbar">
          <div className="segmented scroll no-scrollbar" role="tablist" aria-label={tr("Discover")}>
            {TABS.map((tb) => (
              <div
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                className={`seg ${tab === tb.key ? "seg-active" : ""}`}
                onClick={() => setTab(tb.key)}
              >
                {tr(tb.label)}
              </div>
            ))}
          </div>
          <TabMenu
            value={tab}
            options={TABS.map((t) => ({ key: t.key, label: tr(t.label) }))}
            onPick={setTab}
            menuLabel={tr("Discover")}
          />
        </div>

        {/* Los chips salen de la rejilla que hay delante, así que aparecen
            cuando llega y cambian con la pestaña. Los elegidos se conservan al
            cambiar: filtrar por Switch y pasar de Novedades a Populares es
            seguir preguntando lo mismo sobre otro montón. */}
        {chips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {chips.map((p) => (
              <button
                key={p}
                className={`chip ${platforms.includes(p) ? "chip-active" : ""}`}
                onClick={() => toggle(p)}
              >
                {p}
                {platforms.includes(p) && <X size={12} />}
              </button>
            ))}
          </div>
        )}

        {pool.isLoading && <PosterGridSkeleton />}

        {!pool.isLoading && items.length === 0 && (
          <p className="dim" style={{ fontSize: 14, margin: 0 }}>
            {tr(platforms.length > 0
              ? "No games on those platforms here."
              : "Nothing to show right now.")}
          </p>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
          {shown.map((t) => card(t))}
        </div>

        {more}
      </section>
    </div>
  );
}
