import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { useMovieLibrary, type LibraryMovie } from "@/lib/library";
import { useMovieReleases } from "@/lib/movies";
import { useMovieEpisodeIds } from "@/features/movies/data";
import { MovieReleaseRow } from "@/features/movies/MovieReleaseRow";
import MoviesExplorePage from "@/features/movies/MoviesExplorePage";
import { useMarkWatched } from "@/lib/watch";
import { loadMovieProviders } from "@/lib/providers";
import { qk } from "@/lib/queryKeys";
import { regionCode } from "@/lib/region";
import { tmdbImg } from "@/lib/tmdb";
import { locName, t as tr, useEsNames } from "@/lib/i18n";
import { Poster, Rail, WatchOn } from "@/ui";
import { HeroSkeleton, RailCardsSkeleton, RowsSkeleton } from "@/ui/Skeleton";
import { posterBg } from "@/ui/posterBg";

/* Esta noche, en cine. La misma planta que Tonight de series —hero, carrusel,
   dos columnas— con lo que cambia cuando la obra es atómica.

   No hay "seguir viendo" ni barra de progreso: una película se ve de una vez.
   Lo que ocupa el sitio del "siguiente episodio" es LA ELECCIÓN: de todo lo que
   tienes pendiente, qué puedes poner ahora mismo sin salir de casa.

   Y las dos columnas de abajo son las de series con el medio cambiado:
   "Episodios recientes" → "Nuevo en streaming", "Próximos estrenos" → "Pronto
   en cines". La simetría es deliberada: es la misma pregunta ("¿qué ha salido?"
   y "¿qué va a salir?") en el otro medio. */

/** El hero: lo primero de tu lista que ya puedes ver en una de tus plataformas.
 *
 *  El orden importa y es el argumento de la pantalla. Primero lo DISPONIBLE
 *  —una recomendación que no puedes seguir esta noche no es una
 *  recomendación—; dentro de eso, lo más reciente, que es lo que se te ha
 *  quedado sin ver. Si nada de tu lista está disponible, cae a lo más reciente
 *  a secas, y la ficha dirá dónde se puede ver.
 *
 *  Solo se consulta la CABEZA de la lista, no la biblioteca entera: con las
 *  pendientes ya ordenadas por estreno, la elección sale de las primeras o no
 *  sale de ninguna, y preguntar por doscientas para enseñar una es pagar la
 *  cuadrícula entera de proveedores en cada carga de esta pantalla. */
const HERO_CANDIDATES = 12;

function usePick(movies: LibraryMovie[]): LibraryMovie | undefined {
  const pending = useMemo(
    () => movies.filter((m) => m.status === "watchlist")
      .sort((a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? "")),
    [movies],
  );
  const head = useMemo(() => pending.slice(0, HERO_CANDIDATES), [pending]);
  const region = regionCode();

  // useQueries y no un useProviders por candidata: el número de candidatas
  // cambia con la biblioteca, y un hook dentro de un bucle de longitud variable
  // rompe el orden de los hooks entre renders. Por debajo siguen colapsando en
  // una sola consulta — el batcher de lib/providers junta lo que se pida en el
  // mismo tick.
  const results = useQueries({
    queries: head.map((m) => ({
      queryKey: qk.providers(region, "movie" as const, m.tmdb_id),
      staleTime: 6 * 60 * 60 * 1000,
      queryFn: () => loadMovieProviders(m.tmdb_id),
    })),
  });

  const available = head.find((_, i) => (results[i]?.data?.length ?? 0) > 0);
  return available ?? pending[0];
}

export default function MoviesTonightPage() {
  const { data: movies = [], isPending } = useMovieLibrary();
  const { data: releases = [], isPending: releasesPending } = useMovieReleases(6);
  const { data: episodeIds } = useMovieEpisodeIds();
  const [, setSearchParams] = useSearchParams();
  const esNames = useEsNames();
  const now = useMemo(() => new Date(), []);

  const hero = usePick(movies);
  const heroMark = useMarkWatched(hero?.title_id ?? "");
  const heroEpisodeId = hero ? episodeIds?.get(hero.title_id) ?? null : null;
  /* Mismo arreglo que en Videojuegos y por lo mismo: el póster estirado a un
     banner apaisado es un recorte del centro. Los tamaños son los de Series
     —w1280 para el fotograma, w780 para el póster de respaldo, que no tiene
     rung w1280 y devolvería un 404—. Ver la migración 0080. */
  const heroArt = hero
    ? (tmdbImg(hero.backdrop_path, "w1280") ?? tmdbImg(hero.poster_path, "w780"))
    : undefined;
  const heroName = hero ? locName(esNames, hero.tmdb_id, hero.name, "movie") : "";

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("movie", String(tmdbId));
      return next;
    });

  // La lista, sin el hero: lo que ya está arriba no se repite abajo.
  const rail = movies
    .filter((m) => m.status === "watchlist" && m.title_id !== hero?.title_id)
    .sort((a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""));

  const nowMs = now.getTime();
  const streaming = releases
    .filter((r) => r.release_kind === "digital" && new Date(r.release_at).getTime() <= nowMs)
    .sort((a, b) => b.release_at.localeCompare(a.release_at))
    .slice(0, 4);
  // Solo lo que TMDB fecha COMO estreno de sala. El respaldo 'release' —el que
  // se emite cuando no hay datos de tu país— podría ser una producción de
  // plataforma, y anunciarla bajo "Pronto en cines" es mandar a alguien a un
  // cine que no la pone. Esas salen en Estrenos, bajo su propia píldora.
  const theatres = releases
    .filter((r) => r.release_kind === "theatrical" && new Date(r.release_at).getTime() > nowMs)
    .sort((a, b) => a.release_at.localeCompare(b.release_at))
    .slice(0, 4);

  /* Sin una sola película en la biblioteca, esta pantalla no tiene nada que
     decir: no hay elección de esta noche, no hay lista, y las dos columnas de
     abajo salen de TUS estrenos, así que también están vacías. Lo que se
     enseñaba entonces era un cartel de "añade una peli" rodeado de huecos.
     Mientras esté así, la portada de cine ES Explorar.

     En el sitio, no por redirección: la pestaña activa sigue siendo Tonight y
     la URL no cambia, que es la diferencia entre "aquí todavía no hay nada
     tuyo, mira lo que hay" y una pestaña que te echa a otra parte. En cuanto
     añadas la primera película esta pantalla vuelve sola.

     Va DESPUÉS de todos los hooks —incluidos los de arriba, que ya se han
     llamado— porque un return temprano antes de ellos rompería el orden en el
     primer render con biblioteca. Lo que se paga por eso son dos consultas que
     no se van a pintar; ninguna es cara y ambas estarán calientes cuando esta
     pantalla vuelva a servir para algo. */
  if (!isPending && movies.length === 0) return <MoviesExplorePage />;

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Tonight")}</h1>

      {isPending && <div className="mq-bento"><HeroSkeleton /></div>}

      {hero && (
        <div className="mq-bento">
          <section className="card mq-hero" onClick={() => open(hero.tmdb_id)} style={{ background: posterBg(hero.name) }}>
            {heroArt && <img className="mq-hero-still" src={heroArt} alt="" />}
            <div className="mq-hero-body">
              <div className="mq-hero-eyebrow">{tr("Movie night pick")}</div>
              <h2 className="mq-hero-title">{heroName}</h2>
              <div className="mq-hero-meta flex items-center gap-2 flex-wrap">
                <span>
                  {[hero.first_air_date?.slice(0, 4), hero.genres.slice(0, 2).join(" · ")]
                    .filter(Boolean).join(" · ")}
                </span>
                <WatchOn tmdbId={hero.tmdb_id} kind="movie" />
              </div>
              <div className="mq-hero-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn btn-accent btn-sm"
                  disabled={!heroEpisodeId}
                  onClick={() => heroEpisodeId && heroMark.mutate(heroEpisodeId)}
                >
                  <Check size={14} />{tr("Mark watched")}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => open(hero.tmdb_id)}>{tr("Details")}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {!isPending && !hero && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {tr("Nothing pending — hit {key} and add a movie.")
              .split("{key}")
              .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))}
          </p>
        </div>
      )}

      {isPending ? (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Your watchlist")}><RailCardsSkeleton /></Rail>
        </section>
      ) : rail.length > 0 && (
        <section className="flex flex-col gap-4">
          <Rail
            title={tr("Your watchlist")}
            action={<Link to="/movies/watchlist" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>}
          >
            {rail.map((m) => (
              <div key={m.title_id} style={{ width: "var(--rail-pw)" }}>
                <Poster
                  kind="movie"
                  t={{
                    id: String(m.tmdb_id),
                    name: locName(esNames, m.tmdb_id, m.name, "movie"),
                    year: m.first_air_date?.slice(0, 4) ?? "TBA",
                    genres: m.genres.length ? m.genres : ["—"],
                    posterPath: tmdbImg(m.poster_path),
                    voteAverage: m.vote_average ?? 0,
                    imdbRating: m.imdb_rating,
                  }}
                  onClick={() => open(m.tmdb_id)}
                />
              </div>
            ))}
          </Rail>
        </section>
      )}

      <div className="mq-cols">
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("New to stream")}</h2>
            <Link to="/movies/releases" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {releasesPending && <RowsSkeleton count={3} height={106} />}
            {!releasesPending && streaming.length === 0 && (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("Nothing new on your services.")}</p>
            )}
            {streaming.map((r) => (
              <MovieReleaseRow key={`${r.title_id}-${r.release_kind}`} r={r} now={now} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("In theatres soon")}</h2>
            <Link to="/movies/releases" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {releasesPending && <RowsSkeleton count={3} height={106} />}
            {!releasesPending && theatres.length === 0 && (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("No dated releases yet.")}</p>
            )}
            {theatres.map((r) => (
              <MovieReleaseRow key={`${r.title_id}-${r.release_kind}`} r={r} now={now} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
