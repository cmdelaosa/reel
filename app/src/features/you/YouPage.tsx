import { useMemo, type ComponentType } from "react";
import { useNavigate } from "react-router";
import { CalendarClock, ChevronRight, Clapperboard, Clock, Eye, Film, Gamepad2, History, LayoutGrid, Share2, Star, Timer, Trophy, Tv, Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useLibraryRows } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { useWatchHistory } from "@/lib/history";
import { buildWall } from "@/domain/activityWall";
import { tasteBlocks } from "@/domain/tasteProfile";
import { mediumPlural } from "@/domain/mediumCopy";
import { ratingsRoute, ratingsSummary, ratingsSummaryLine } from "@/domain/ratingsList";
import { MEDIA } from "@/domain/tasteScope";
import { useUserStats, timeSpentLabel } from "@/lib/stats";
import { t as tr, tv } from "@/lib/i18n";
import { StatsSkeleton } from "@/ui/Skeleton";
import { hueOf } from "@/ui/posterBg";
import { ActivityWall } from "@/features/social/ActivityWall";
import { TasteBlocks } from "@/features/social/TasteBlocks";
import { WatchHeatmap } from "@/features/you/WatchHeatmap";

/* You — profile header, your libraries, your ratings and your activity. Port of
   prototype marquee.tsx → You; the stats grid lands in P2-C9.

   La lista de notas ya no está aquí: era la última sección, la más larga de la
   página (1.460 filas paginadas) y la única puerta a tus notas. Ahora hay tres
   tarjetas —una por medio— que abren su pantalla (features/you/RatingsPage).

   Esta página NO mira el conmutador de medio: es el único sitio donde te ves
   entero, con las series, el cine y los juegos a la vez. Por eso los gustos son
   tres bloques (domain/tasteProfile), el muro mezcla los tres (domain/
   activityWall) y la rejilla de actividad tiñe cada día del medio que más pesó
   en él. */

/* Cuántas filas del historial alimentan el muro. Es la primera página de
   `useWatchHistory`, que ya está pedida en cuanto abres Historial, así que aquí
   no cuesta un viaje nuevo: 60 episodios dan de sobra para las doce filas que
   el muro enseña de entrada, incluso plegando poco. */
const WALL_FROM_HISTORY = 60;

/* Una tarjeta de acceso del perfil: icono, rótulo, un renglón pequeño con la
   cifra y la flecha. La usan las dos filas de arriba —tus bibliotecas y tus
   notas—, que tienen que verse iguales porque son lo mismo: puertas a otra
   pantalla con un número que dice qué hay al otro lado. */
function AccessCard(
  { icon: Icon, label, sub, onClick }:
  { icon: ComponentType<{ size?: number }>; label: string; sub: string; onClick: () => void },
) {
  return (
    <button className="card p-4 flex items-center gap-3 text-left" style={{ cursor: "pointer" }} onClick={onClick}>
      <span
        className="grid place-items-center"
        style={{
          width: 38, height: 38, borderRadius: "var(--r-sm)", flex: "0 0 auto",
          background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)",
        }}
      >
        <Icon size={18} />
      </span>
      <span className="flex-1 min-w-0">
        <span style={{ display: "block", fontWeight: 750, fontSize: 15 }}>{label}</span>
        <span className="mute" style={{ display: "block", fontSize: 12.5 }}>{sub}</span>
      </span>
      <ChevronRight size={17} className="mute" />
    </button>
  );
}

export default function YouPage() {
  const { profile } = useAuth();
  const { data: ratings = [] } = useMyRatings();
  const { data: stats } = useUserStats();
  const { data: library = [] } = useLibraryRows();
  const { data: history } = useWatchHistory();
  const navigate = useNavigate();

  /* Cuántas notas tienes de cada medio y con qué media, que es lo que prometen
     las tres tarjetas de abajo. La lista en sí ya no vive aquí: cada medio tiene
     su pantalla (features/you/RatingsPage), y la cuenta que enseña la tarjeta y
     las filas que enseña esa pantalla salen del mismo módulo para que no puedan
     decir cosas distintas (domain/ratingsList). */
  const rateSummary = useMemo(
    () => ratingsSummary(ratings.map((r) => ({ score: r.score, kind: r.titles.kind }))),
    [ratings],
  );

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
          <AccessCard key={l.path} icon={l.icon} label={l.label} sub={l.sub} onClick={() => navigate(l.path)} />
        ))}
      </div>

      {/* Tus notas: una puerta por medio, con su cuenta y su media.

          Aquí había la lista entera —1.460 filas paginadas de quince en quince,
          con su propio filtro de medio— y era la última sección de la página,
          debajo del muro y del mapa de calor. Es lo más grande que tiene el
          perfil y estaba donde menos se ve; ahora cada medio tiene su pantalla
          (RatingsPage) y esto es lo que lleva a ella.

          Los medios sin ni una nota no se pintan, la misma regla que los accesos
          de arriba y las estadísticas de abajo: a quien solo ve series, dos
          tarjetas a cero le dicen menos que nada. Y si no has puntuado nada de
          nada, en vez de tres huecos va la frase que dice cómo se empieza. */}
      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">{tr("Your ratings")}</h2>
          </div>
        </div>

        {ratings.length === 0 ? (
          <div className="card" style={{ padding: "28px 24px" }}>
            <p className="dim" style={{ margin: 0, fontSize: 14 }}>
              {tr("No ratings yet — open a show and tap the stars.")}
            </p>
          </div>
        ) : (
          /* auto-FILL y no auto-fit, que es lo que usa la fila de arriba: aquí
             puede haber una sola tarjeta —quien solo puntúa series—, y con
             auto-fit esa única se estira de lado a lado y parece un cartel. Con
             auto-fill se queda del ancho de una tarjeta, en su sitio. */
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {MEDIA.filter((m) => rateSummary[m].count > 0).map((m) => (
              <AccessCard
                key={m}
                icon={Star}
                label={tr(mediumPlural(m))}
                sub={tv(ratingsSummaryLine(m, rateSummary[m].count), {
                  n: rateSummary[m].count.toLocaleString(),
                  avg: rateSummary[m].avg!.toFixed(1),
                })}
                onClick={() => navigate(ratingsRoute(m))}
              />
            ))}
          </div>
        )}
      </section>

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
    </div>
  );
}
