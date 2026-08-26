import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, Clock, Eye, Film, Gamepad2, History, LayoutGrid, Share2, Star, Timer, Trophy, Tv, Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useLibraryRows } from "@/lib/library";
import { useMyRatings, type RatedRow } from "@/lib/ratings";
import { useWatchHistory } from "@/lib/history";
import { buildWall } from "@/domain/activityWall";
import { tasteBlocks } from "@/domain/tasteProfile";
import { mediumPlural } from "@/domain/mediumCopy";
import { MEDIA, sheetParam, type Medium } from "@/domain/tasteScope";
import { useUserStats, timeSpentLabel } from "@/lib/stats";
import { thumbArt } from "@/lib/artwork";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { Stars } from "@/ui";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { StatsSkeleton } from "@/ui/Skeleton";
import { hueOf, posterBg } from "@/ui/posterBg";
import { ActivityWall } from "@/features/social/ActivityWall";
import { TasteBlocks } from "@/features/social/TasteBlocks";
import { WatchHeatmap } from "@/features/you/WatchHeatmap";

/* You — profile header + your ratings (sort + 15/page). Port of prototype
   marquee.tsx → You; the stats grid lands in P2-C9.

   Esta página NO mira el conmutador de medio: es el único sitio donde te ves
   entero, con las series, el cine y los juegos a la vez. Por eso los gustos son
   tres bloques (domain/tasteProfile), el muro mezcla los tres (domain/
   activityWall) y la rejilla de actividad tiñe cada día del medio que más pesó
   en él. */

const RATE_PAGE = 15;
type RateSort = "new" | "old" | "best" | "worst";
/** El filtro de medio de tus notas. "all" es un cuarto valor y no la ausencia
 *  del filtro: es lo que la barra tiene seleccionado al abrir. */
type RateMedium = Medium | "all";

/* Cuántas filas del historial alimentan el muro. Es la primera página de
   `useWatchHistory`, que ya está pedida en cuanto abres Historial, así que aquí
   no cuesta un viaje nuevo: 60 episodios dan de sobra para las doce filas que
   el muro enseña de entrada, incluso plegando poco. */
const WALL_FROM_HISTORY = 60;

function ratedAtLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return tr("today");
  if (days === 1) return tr("yesterday");
  if (days < 30) return tv("{days} days ago", { days });
  return new Date(iso).toLocaleDateString(dateLocale(), { month: "short", year: "numeric" });
}

function RatingRow({ r, onOpen }: { r: RatedRow; onOpen: () => void }) {
  const t = r.titles;
  /* La carátula sale de una fuente distinta según el medio: un juego guarda un
     hash de IGDB donde series y cine guardan una ruta de TMDB (0071). thumbArt
     lo resuelve; tmdbImg a secas devolvía una URL bien formada que responde 404
     sin quejarse — o sea, todas tus notas de juegos sin carátula y ni un error
     en consola que lo explicara. */
  const art = thumbArt(t.kind, t.poster_path);
  const esNames = useEsNames();
  const name = locName(esNames, t.tmdb_id, t.name, t.kind);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate" style={{ marginTop: 0 }}>{name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? ""), `${tr("rated")} ${ratedAtLabel(r.created_at)}`].filter(Boolean).join(" · ")}
        </div>
        <div style={{ marginTop: 4 }}><Stars score={r.score} size={13} /></div>
      </div>
      {/* De qué medio es la nota. Tus notas son de los tres y sin esto la única
          pista era la carátula, que en un juego y en una película se parecen. */}
      <MediumGlyph kind={t.kind} />
      <div className="mq-score">{r.score}<span>/10</span></div>
    </div>
  );
}

export default function YouPage() {
  const { profile } = useAuth();
  const { data: ratings = [] } = useMyRatings();
  const { data: stats } = useUserStats();
  const { data: library = [] } = useLibraryRows();
  const { data: history } = useWatchHistory();
  const [sort, setSort] = useState<RateSort>("new");
  const [rateMedium, setRateMedium] = useState<RateMedium>("all");
  const [page, setPage] = useState(0);
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const byNew = (a: RatedRow, b: RatedRow) => b.created_at.localeCompare(a.created_at);
  const rated = [...ratings]
    .filter((r) => rateMedium === "all" || r.titles.kind === rateMedium)
    .sort((a, b) => {
      if (sort === "new") return byNew(a, b);
      if (sort === "old") return -byNew(a, b);
      if (sort === "best") return b.score - a.score || byNew(a, b);
      return a.score - b.score || byNew(a, b);
    });

  const pageCount = Math.max(1, Math.ceil(rated.length / RATE_PAGE));
  const clamped = Math.min(page, pageCount - 1);
  const start = clamped * RATE_PAGE;
  const shown = rated.slice(start, start + RATE_PAGE);

  /* Tus notas son de los tres medios, así que cada fila se abre con el
     parámetro del suyo: `?title=` sobre una película llevaba a la ficha de la
     serie con ese número —o a ninguna—, porque el id solo es único dentro de su
     medio (domain/tasteScope, `sheetParam`). */
  const open = (tmdbId: number, kind: Medium) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(sheetParam(kind), String(tmdbId));
      return next;
    });

  const sorts: { v: RateSort; label: string }[] = [
    { v: "new", label: tr("Newest") },
    { v: "old", label: tr("Oldest") },
    { v: "best", label: tr("Best rated") },
    { v: "worst", label: tr("Worst rated") },
  ];

  /* El filtro de medio solo se ofrece si hay más de uno que filtrar: con notas
     de un medio solo, cuatro pestañas de las que tres devuelven vacío. */
  const ratedMedia = useMemo(() => {
    const present = new Set(ratings.map((r) => r.titles.kind));
    return MEDIA.filter((m) => present.has(m));
  }, [ratings]);

  /* Tu perfil de gustos, uno por medio. Leía `useLibrary()`, que filtra a
     series desde 0067: "tus gustos" eran los de un tercio de lo que usas. */
  const taste = useMemo(() => tasteBlocks(library), [library]);

  /* Tu muro: lo visto, lo puntuado y lo añadido, plegado. El plegado es lo que
     impide que la importación de InfiniteBacklog (386 juegos en una tarde) sea
     386 filas que entierran todo lo demás. */
  const wall = useMemo(
    () => buildWall({
      watched: (history?.pages[0] ?? []).slice(0, WALL_FROM_HISTORY).map((h) => ({
        at: h.watched_at, kind: h.kind, tmdb_id: h.tmdb_id, name: h.show_name,
        poster_path: h.poster_path, season_number: h.season_number, episode_number: h.episode_number,
      })),
      rated: ratings.map((r) => ({
        at: r.created_at, kind: r.titles.kind, tmdb_id: r.titles.tmdb_id,
        name: r.titles.name, poster_path: r.titles.poster_path, score: r.score,
      })),
      added: library.map((l) => ({
        at: l.added_at, kind: l.kind, tmdb_id: l.tmdb_id,
        name: l.name, poster_path: l.poster_path, owned: l.owned,
      })),
    }),
    [history, ratings, library],
  );

  /* Los accesos de arriba. Eran dos —"Mis series" e Historial— en una app de
     tres medios, así que tu cine y tus juegos no tenían puerta desde tu perfil.
     Se ocultan los vacíos, la misma regla que las estadísticas de abajo: a
     quien solo ve series, dos tarjetas a cero le dicen menos que nada. */
  const counts = useMemo(() => ({
    tv: library.filter((l) => l.kind === "tv").length,
    movie: library.filter((l) => l.kind === "movie").length,
    game: library.filter((l) => l.kind === "game").length,
  }), [library]);

  /* Cada tarjeta apunta a la BIBLIOTECA de su medio, no al prefijo del modo.
     `/movies` y `/games` a secas no son pantallas: redirigen a la portada de su
     modo (main.tsx), así que "Mi cine" llevaba a Esta noche — la única de las
     tres que acertaba era Series, porque su biblioteca sí vive en la raíz.

     Y por eso van escritas enteras: la ruta de cada biblioteca no se deduce del
     medio. La de series es `/shows`, la de cine `/movies/watchlist` y la de
     juegos `/games/backlog` —que se llama así, y no `library`, porque la
     pestaña que lleva a ella se llama Pendientes—. Tres nombres que no siguen
     un patrón son tres nombres que hay que decir.

     El `?filter=all` tampoco sobra, y es lo que separa a estas tarjetas de las
     pestañas de la barra: las tres bibliotecas abren en un CUBO cuando la URL
     no lo dice —Viendo, Sin empezar, Pendientes—, y aquí la tarjeta acaba de
     prometer un número que es la biblioteca ENTERA. Sin él, "386 en tu
     biblioteca" lleva a unos Pendientes con doce, porque los otros 374 entraron
     por Steam marcados "Lo tengo". La pestaña de la barra sí abre en su cubo, y
     hace bien: se llama como él. */
  const links = [
    { icon: LayoutGrid, label: tr("My Shows"), sub: tv("{n} in your library", { n: counts.tv }), path: "/shows?filter=all", show: counts.tv > 0 },
    { icon: Clapperboard, label: tr("My Movies"), sub: tv("{n} in your library", { n: counts.movie }), path: "/movies/watchlist?filter=all", show: counts.movie > 0 },
    { icon: Gamepad2, label: tr("My Games"), sub: tv("{n} in your library", { n: counts.game }), path: "/games/backlog?filter=all", show: counts.game > 0 },
    { icon: History, label: tr("History"), sub: tr("Everything you've watched"), path: "/history", show: true },
  ].filter((l) => l.show);

  const initial = (profile?.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="screen mq-page">
      <div
        className="card profile-head overflow-hidden"
        style={{ "--fr-hue": hueOf(profile?.id ?? "") } as React.CSSProperties}
      >
        <div className="p-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex items-end gap-4">
              <div className="profile-avatar grid place-items-center overflow-hidden">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  initial
                )}
              </div>
              <div className="pb-1">
                <div style={{ fontSize: 22, fontWeight: 800 }}>{profile?.display_name}</div>
                <div className="dim" style={{ fontSize: 13.5 }}>@{profile?.handle}</div>
              </div>
            </div>
            <button className="btn btn-outline" title={tr("Sharing lands with friends (Phase 4)")}>
              <Share2 size={16} />{tr("Share profile")}
            </button>
          </div>
        </div>
      </div>

      {/* My Shows + History moved off the top tabs — they live here now */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {links.map((l) => (
          <button
            key={l.path}
            className="card p-4 flex items-center gap-3 text-left"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(l.path)}
          >
            <span
              className="grid place-items-center"
              style={{
                width: 38, height: 38, borderRadius: "var(--r-sm)", flex: "0 0 auto",
                background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)",
              }}
            >
              <l.icon size={18} />
            </span>
            <span className="flex-1 min-w-0">
              <span style={{ display: "block", fontWeight: 750, fontSize: 15 }}>{l.label}</span>
              <span className="mute" style={{ display: "block", fontSize: 12.5 }}>{l.sub}</span>
            </span>
            <ChevronRight size={17} className="mute" />
          </button>
        ))}
      </div>

      {!stats && <StatsSkeleton />}
      {stats && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[
            /* Cada medio cuenta por separado (0069 el cine, 0074 los juegos):
               una película no es un episodio y un juego no es ninguno de los
               dos, y sumarlos bajo una etiqueta sola es lo que hacía falsa la
               cifra. Los minutos de VER sí van juntos — son minutos, y no
               cambian de unidad al cambiar de medio—, pero los de JUGAR no:
               salen de lo que escribiste a mano (0073), no de un runtime, y
               mezclarlos le habría inventado cuarenta minutos a cada juego.
               Las de cine y juegos solo se pintan si tienes algo: a quien solo
               ve series, cinco ceros permanentes le dicen menos que nada. */
            { icon: Eye, label: tr("Episodes watched"), value: stats.episodes_watched.toLocaleString() },
            ...(stats.movies_watched > 0
              ? [{ icon: Film, label: tr("Movies watched"), value: stats.movies_watched.toLocaleString() }]
              : []),
            ...(stats.games_finished > 0
              ? [{ icon: Trophy, label: tr("Games finished"), value: stats.games_finished.toLocaleString() }]
              : []),
            { icon: Clock, label: tr("Time spent"), value: timeSpentLabel(stats.minutes_watched) },
            /* timeSpentLabel y no formatPlaytime, que es el formateador propio
               de los juegos: aquí la cifra vive al lado de "Tiempo visto" y las
               dos tienen que leerse de un vistazo con la misma unidad. El "18 h
               30 min" fino es de la ficha, donde se compara con lo que tarda en
               terminarse. */
            ...(stats.minutes_played > 0
              ? [{ icon: Timer, label: tr("Time played"), value: timeSpentLabel(stats.minutes_played) }]
              : []),
            { icon: Tv, label: tr("Shows followed"), value: String(stats.shows_followed) },
            ...(stats.movies_followed > 0
              ? [{ icon: Clapperboard, label: tr("Movies in your list"), value: String(stats.movies_followed) }]
              : []),
            ...(stats.games_followed > 0
              ? [{ icon: Gamepad2, label: tr("Games in your list"), value: String(stats.games_followed) }]
              : []),
            { icon: CalendarClock, label: tr("Coming soon"), value: String(stats.coming_soon) },
            { icon: Users, label: tr("Friends"), value: String(stats.friends) },
            { icon: Star, label: tr("Avg. rating"), value: stats.avg_rating != null ? stats.avg_rating.toFixed(1) : "—" },
          ].map((s) => (
            <div key={s.label} className="card p-4 flex flex-col gap-1">
              <s.icon size={18} style={{ color: "var(--accent)" }} />
              <div style={{ fontSize: 22, fontWeight: 800 }} className="mt-1">{s.value}</div>
              <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* La rejilla se lleva la fila entera: al lado ya no hay un solo bloque de
          gustos sino tres, y esos van debajo en su propia parrilla. */}
      <section className="taste-grid">
        <WatchHeatmap />
      </section>

      <TasteBlocks blocks={taste} />

      <ActivityWall items={wall} isMe />

      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">{tr("Your ratings")}</h2>
          </div>
        </div>

        <div className="mq-rate-toolbar">
          <div className="segmented scroll no-scrollbar">
            {sorts.map((s) => (
              <div key={s.v} className={`seg ${sort === s.v ? "seg-active" : ""}`} onClick={() => { setSort(s.v); setPage(0); }}>
                {s.label}
              </div>
            ))}
          </div>
          {ratedMedia.length > 1 && (
            <div className="segmented scroll no-scrollbar">
              {([["all", tr("All")] as const, ...ratedMedia.map((m) => [m, tr(mediumPlural(m))] as const)]).map(([v, label]) => (
                <div
                  key={v}
                  className={`seg ${rateMedium === v ? "seg-active" : ""}`}
                  onClick={() => { setRateMedium(v); setPage(0); }}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
          {rated.length > 0 && (
            <span className="mute" style={{ fontSize: 12.5 }}>
              {start + 1}–{Math.min(start + RATE_PAGE, rated.length)} {tr("of")} {rated.length}
            </span>
          )}
        </div>

        {rated.length === 0 && (
          <div className="card" style={{ padding: "28px 24px" }}>
            <p className="dim" style={{ margin: 0, fontSize: 14 }}>
              {tr("No ratings yet — open a show and tap the stars.")}
            </p>
          </div>
        )}

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
          {shown.map((r) => (
            <RatingRow key={r.id} r={r} onOpen={() => open(r.titles.tmdb_id, r.titles.kind)} />
          ))}
        </div>

        {pageCount > 1 && (
          <div className="mq-pager">
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === 0}
              style={{ opacity: clamped === 0 ? 0.4 : 1, pointerEvents: clamped === 0 ? "none" : "auto" }}
              onClick={() => setPage(clamped - 1)}
            >
              <ChevronLeft size={15} />{tr("Prev")}
            </button>
            <span>{tr("Page")} {clamped + 1} {tr("of")} {pageCount}</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === pageCount - 1}
              style={{ opacity: clamped === pageCount - 1 ? 0.4 : 1, pointerEvents: clamped === pageCount - 1 ? "none" : "auto" }}
              onClick={() => setPage(clamped + 1)}
            >
              {tr("Next")}<ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
