import { useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { useGameLibrary, type LibraryGame } from "@/lib/library";
import { igdbImg, useSetGameProgress } from "@/lib/igdb";
import { formatPlaytime } from "@/domain/gameStatus";
import { formatRelease } from "@/domain/gameRelease";
import { orderByTouched, pickResume } from "@/domain/gameTonight";
import { GameReleaseRow } from "@/features/games/GameReleaseRow";
import { isEs, t as tr } from "@/lib/i18n";
import { Poster, Rail } from "@/ui";
import { HeroSkeleton, RailCardsSkeleton, RowsSkeleton } from "@/ui/Skeleton";
import { posterBg } from "@/ui/posterBg";

/* Esta noche, en juegos. La tercera con esta planta —héroe, carrusel, dos
   columnas— y la que más se separa de las otras dos en lo que pone dentro.

   Series pregunta "¿por dónde iba?", cine pregunta "¿qué pongo?", y juegos
   pregunta lo primero y no lo segundo: un juego empezado se RETOMA. Elegir
   entre veinte pendientes es lo que hace que un backlog dé pereza, y para eso
   está la pestaña Pendientes, que es adonde va quien quiere elegir. La regla
   entera —a qué se vuelve y en qué orden— vive en domain/gameTonight, con sus
   pruebas.

   Y la acción principal del héroe no es "marcar terminado". En cine, marcar
   visto es lo que haces con una película esta noche; terminarse un juego pasa
   una vez cada treinta horas. Lo que sí haces cada sesión es apuntar el rato,
   así que los botones son los mismos saltos de la ficha (+30 min, +2 h) — el
   equivalente honesto de "marcar visto" en un medio que se mide en horas. */

/* Los mismos que la ficha, y a propósito: dos sitios que apuntan lo mismo con
   dos saltos distintos son dos sitios que hay que comparar antes de usar. */
const BUMPS = [30, 120];

/** Cuánto hace atrás llega "Recién salidos". Dos meses y no dos semanas porque
 *  un juego no se ve el día que sale: sale, lo compras cuando baja, lo empiezas
 *  el finde siguiente. */
const JUST_OUT_MS = 60 * 24 * 60 * 60 * 1000;

export default function GamesTonightPage() {
  const { data: games = [], isPending } = useGameLibrary();
  const [, setSearchParams] = useSearchParams();
  const setProgress = useSetGameProgress();
  const now = useMemo(() => new Date(), []);
  const es = isEs();

  const hero = pickResume(games);
  const rail = useMemo(
    () => orderByTouched(games).filter((g) => g.title_id !== hero?.title_id),
    [games, hero],
  );

  const open = (igdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("game", String(igdbId));
      return next;
    });

  /* Lo último que hemos escrito nosotros, para no sumar dos veces sobre el mismo
     número. `useSetGameProgress` invalida y espera al refetch, así que entre que
     la escritura termina —y el botón se reactiva— y la biblioteca vuelve, el
     render sigue enseñando los minutos de antes: dos pulsaciones seguidas de
     "+30 min" escribían las dos 18 h 30, y la segunda parecía no hacer nada. */
  const lastWritten = useRef<{ titleId: string; minutes: number } | null>(null);

  const bump = (g: LibraryGame, delta: number) => {
    const stored = g.minutes_played ?? 0;
    // El máximo, no el último escrito a secas: si las horas se corrigen desde la
    // ficha a un número menor, lo que manda es lo que dice la biblioteca en
    // cuanto llega — y en cuanto llega los dos valen lo mismo.
    const base = lastWritten.current?.titleId === g.title_id
      ? Math.max(lastWritten.current.minutes, stored)
      : stored;
    const minutes = Math.max(0, base + delta);
    lastWritten.current = { titleId: g.title_id, minutes };
    setProgress.mutate({ titleId: g.title_id, minutesPlayed: minutes });
  };

  const today = now.toISOString().slice(0, 10);
  const nowMs = now.getTime();

  const justOut = useMemo(
    () =>
      games
        .filter((g) => {
          if (g.status === "upcoming" || g.status === "finished") return false;
          if (!g.first_air_date || g.first_air_date > today) return false;
          return nowMs - new Date(`${g.first_air_date}T00:00:00Z`).getTime() <= JUST_OUT_MS;
        })
        .sort((a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""))
        .slice(0, 4),
    [games, today, nowMs],
  );

  /* Los anunciados SIN fecha van al final y no fuera: un juego que sigues y del
     que IGDB no dice ni el año sigue siendo algo que esperas, y esconderlo
     porque la fuente no se moja sería esconder justo lo que más se pregunta.
     Sale con su "Sin fecha", que es lo que la fila sabe decir. */
  const soon = useMemo(
    () =>
      games
        .filter((g) => g.status === "upcoming")
        .sort((a, b) => (a.first_air_date ?? "9999").localeCompare(b.first_air_date ?? "9999"))
        .slice(0, 4),
    [games],
  );

  const heroArt = hero ? igdbImg(hero.poster_path, "cover_big") : undefined;
  const heroMinutes = hero?.minutes_played ?? 0;

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Tonight")}</h1>

      {isPending && <div className="mq-bento"><HeroSkeleton /></div>}

      {hero && (
        <div className="mq-bento">
          <section className="card mq-hero" onClick={() => open(hero.tmdb_id)} style={{ background: posterBg(hero.name) }}>
            {heroArt && <img className="mq-hero-still" src={heroArt} alt="" />}
            <div className="mq-hero-body">
              <div className="mq-hero-eyebrow">
                {tr(hero.status === "playing" ? "Pick up where you left off" : "Start something")}
              </div>
              <h2 className="mq-hero-title">{hero.name}</h2>
              <div className="mq-hero-meta flex items-center gap-2 flex-wrap">
                <span>
                  {[
                    formatRelease(hero.first_air_date, hero.release_precision, { es }),
                    hero.genres.slice(0, 2).join(" · "),
                    (hero.platforms ?? []).slice(0, 2).join(" · "),
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>

              {/* El reloj del juego, que es lo que en una serie sería "vas por
                  el 3x07". La barra solo cuando hay denominador honesto: sin
                  tiempos de IGDB, o en un juego sin final, `progress` es null y
                  las horas se enseñan a secas (domain/gameStatus). */}
              <div className="mq-hero-meta flex items-center gap-2 flex-wrap" style={{ marginTop: 2 }}>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                  {formatPlaytime(heroMinutes)}
                </span>
                {hero.progress != null && (
                  <span className="pbar pbar-inline" style={{ width: 120 }} aria-hidden>
                    <i style={{ width: `${Math.min(hero.progress, 100)}%` }} />
                  </span>
                )}
              </div>

              <div className="mq-hero-actions" onClick={(e) => e.stopPropagation()}>
                {BUMPS.map((m, i) => (
                  <button
                    key={m}
                    className={`btn btn-sm ${i === 0 ? "btn-accent" : "btn-ghost"}`}
                    disabled={setProgress.isPending}
                    onClick={() => bump(hero, m)}
                  >
                    +{formatPlaytime(m)}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => open(hero.tmdb_id)}>{tr("Details")}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {!isPending && !hero && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {tr("Nothing on the go — hit {key} and add a game.")
              .split("{key}")
              .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))}
          </p>
        </div>
      )}

      {isPending ? (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Playing")}><RailCardsSkeleton /></Rail>
        </section>
      ) : rail.length > 0 && (
        <section className="flex flex-col gap-4">
          <Rail
            title={tr("Playing")}
            action={
              <Link to="/games/backlog?filter=playing" className="btn btn-ghost btn-sm">
                {tr("See all")} <ChevronRight size={14} />
              </Link>
            }
          >
            {rail.map((g) => (
              <div key={g.title_id} style={{ width: "var(--rail-pw)" }}>
                <Poster
                  showProviders={false}
                  subtitle={(g.minutes_played ?? 0) > 0 ? formatPlaytime(g.minutes_played ?? 0) : undefined}
                  t={{
                    id: String(g.tmdb_id),
                    name: g.name,
                    year: g.first_air_date?.slice(0, 4) ?? "TBA",
                    genres: g.genres.length ? g.genres : ["—"],
                    posterPath: igdbImg(g.poster_path),
                    voteAverage: g.vote_average ?? 0,
                    progress: g.progress != null ? Math.min(g.progress, 100) : undefined,
                  }}
                  onClick={() => open(g.tmdb_id)}
                />
              </div>
            ))}
          </Rail>
        </section>
      )}

      <div className="mq-cols">
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("Just out")}</h2>
            <Link to="/games/releases" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {isPending && <RowsSkeleton count={3} height={106} />}
            {!isPending && justOut.length === 0 && (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("Nothing out recently.")}</p>
            )}
            {justOut.map((g) => <GameReleaseRow key={g.title_id} g={g} now={now} />)}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("Coming soon")}</h2>
            <Link to="/games/releases" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {isPending && <RowsSkeleton count={3} height={106} />}
            {!isPending && soon.length === 0 && (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("Nothing announced in the games you follow.")}</p>
            )}
            {soon.map((g) => <GameReleaseRow key={g.title_id} g={g} now={now} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
