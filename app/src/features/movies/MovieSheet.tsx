import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, Minus, Plus, Star, X } from "lucide-react";
import { getMovie, getMovieCredits, getMovieSaga, tmdbImg } from "@/lib/tmdb";
import { qk } from "@/lib/queryKeys";
import { fmtPlainDate } from "@/lib/region";
import { dateLocale, isEs, t as tr, tGenre, tv } from "@/lib/i18n";
import { useFollow, useMovieLibrary, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { useWatched } from "@/features/detail/data";
import type { TitleRow } from "@/lib/schemas";
import { externalScore, scoreColor, scoreLabel } from "@/domain/externalScore";
import { FriendsOnTitle } from "@/features/social/FriendsOnTitle";
import { CastRail } from "@/ui/CastRail";
import { personaDelReparto } from "@/ui/railPerson";
import { RatingStars } from "@/ui/RatingStars";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { Trailer } from "@/ui/Trailer";
import { Lightbox } from "@/ui/Lightbox";
import { useFriendsOnTitle } from "@/lib/friendsOnTitle";

/* Ficha de película — la gemela de DetailSheet para el cine, abierta por el
   parámetro global ?movie=.

   Lo que NO tiene, y por qué: temporadas, lista de episodios, gráfica por
   temporada y "Todo visto". Los cuatro describen una obra por partes, y una
   película es un solo acto — de ahí que marcarla vista sea un botón único en
   vez de una columna de checks.

   Lo que tiene en su lugar:
     · la ficha técnica (dirección y guion), con el DIRECTOR ENLAZADO a su
       página — la misma /person/:id que ya abre el reparto;
     · la saga (belongs_to_collection de TMDB) con tu estado por entrega, que es
       el sustituto natural de la lista de episodios: por ahí se navega.

   La fila de notas se parece a la de series pero no es la misma: en cine la
   nota ajena es UNA —la de IMDb, con la de TMDB de reserva— en vez de las dos
   en paralelo. Es la nota que se cita de una película, y dos números que casi
   nunca coinciden en el mismo renglón no informan, obligan a elegir. La regla
   vive en domain/externalScore y la comparte con las carátulas, para que la
   miniatura y la ficha no puedan decir cosas distintas de la misma peli. */

export function MovieSheet({ tmdbId, onClose }: { tmdbId: number; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const navigate = useNavigate();

  const { data, isPending } = useQuery({
    queryKey: qk.movie(tmdbId),
    queryFn: () => getMovie(tmdbId),
    staleTime: 60 * 60 * 1000,
  });
  const title = data?.title;
  const episodeId = data?.episode_id ?? null;

  const { data: movies = [] } = useMovieLibrary();
  const entry = movies.find((m) => m.title_id === title?.id);
  const added = Boolean(entry);
  const follow = useFollow();
  const unfollow = useUnfollow();
  const { isIgnored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();

  // El "visto" de una película es su episodio sintético (0067), así que el mapa
  // de vistos y las dos mutaciones son exactamente los de series.
  const { data: watched } = useWatched(title?.id ?? null);
  const markWatched = useMarkWatched(title?.id ?? "");
  const unmarkWatched = useUnmarkWatched(title?.id ?? "");
  const watchEventId = episodeId ? watched?.get(episodeId) : undefined;
  const seen = Boolean(watchEventId);

  const { data: myRating } = useMyRating(title?.id ?? null);
  const rateTitle = useRateTitle(title?.id ?? "");
  const rating = myRating ?? 0;

  /* El cartel a tamaño completo y la lista de amigos, los dos plegados: la
     ficha enseña la media —«¿está bien?»— y solo si quieres saber quién, se
     abre. La media se calcula de las MISMAS filas que pinta FriendsOnTitle,
     no de la consulta de gustos, para que el número resuma exactamente la
     lista que aparece debajo. */
  const [posterOpen, setPosterOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

  /* La nota ajena de esta película: IMDb, o TMDB de reserva. Null mientras la
     ficha carga y en la peli que nadie ha puntuado en ninguna de las dos. */
  const score = externalScore(title);

  const { data: credits } = useQuery({
    queryKey: qk.movieCredits(tmdbId),
    enabled: Boolean(title),
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => getMovieCredits(tmdbId),
  });
  const cast = credits?.cast ?? [];
  const directors = (credits?.crew ?? []).filter((c) => c.job === "Director");
  const writers = (credits?.crew ?? []).filter((c) => c.job !== "Director");

  const { data: saga } = useQuery({
    queryKey: qk.movieSaga(tmdbId),
    enabled: Boolean(title?.collection_id),
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => getMovieSaga(tmdbId),
  });

  const openPerson = (id: number) => { onClose(); navigate(`/person/${id}`); };

  // Escape cierra, igual que en la ficha de una serie (DetailSheet). Un diálogo
  // modal que no responde a Escape deja sin salida a quien navega con teclado.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const poster = tmdbImg(title?.poster_path ?? null, "w342");
  const posterFull = tmdbImg(title?.poster_path ?? null, "w780");
  /* El primero de `videos` es el mejor tráiler: el proxy ya los deja ordenados
     —oficial antes que no oficial, tráiler antes que teaser— igual que en la
     ficha de un juego, y por eso la misma columna sirve para las dos. */
  const trailer = title?.videos?.[0] ?? null;
  const backdrop = tmdbImg(title?.backdrop_path ?? null, "w780");
  const displayName = (isEs() && title?.name_es) || title?.name || "";
  const displayOverview = (isEs() && title?.overview_es) || title?.overview || "";
  const originalTitle =
    title?.original_name && title.original_name !== displayName ? title.original_name : null;
  const released = Boolean(title?.first_air_date && title.first_air_date <= new Date().toISOString().slice(0, 10));

  /* La media de los amigos que la han puntuado, para la celda de la fila de
     notas. Sale de las mismas filas que pinta FriendsOnTitle al desplegarla, y
     no de la consulta de gustos: así el número resume exactamente esa lista.
     Sin nadie que la haya puntuado no hay celda —una media de cero no es cero—
     aunque la lista sí tenga a quien la tiene pendiente. */
  const amigos = useFriendsOnTitle({ titleId: title?.id ?? null, episodeId, kind: "movie", tmdbId });
  const puntuadas = amigos.map((f) => f.score).filter((s): s is number => s != null);
  const friendsAvg = puntuadas.length
    ? puntuadas.reduce((suma, s) => suma + s, 0) / puntuadas.length
    : null;

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? tv("{name} details", { name: displayName }) : tr("Movie details")}
        tabIndex={-1}
        className="detail-sheet sheet-center fixed z-[70] card overflow-hidden flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(760px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
        }}
      >
        {isPending || !title ? (
          <div className="overflow-y-auto p-6 flex flex-col gap-4">
            {[220, 60, 120].map((h, i) => (
              <div key={i} style={{ height: h }} className="skeleton" />
            ))}
          </div>
        ) : (
          <>
            {/* Héroe */}
            <div
              className="relative detail-hero"
              style={{ background: backdrop ? `url(${backdrop}) center/cover` : posterBg(title.name) }}
            >
              <div className="poster-sheen" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
              {/* Las de gestión, agrupadas con la de salir. Una película no se
                  «para»: se ve o no se ve, así que aquí son dos y no tres. */}
              <div className="detail-hero-actions">
                {added && entry ? (
                  <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                          onClick={() => unfollow.mutate(entry.title_id)}>
                    <Minus size={14} /><span className="btn-label">{tr("Remove")}</span>
                  </button>
                ) : (
                  <>
                    <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                            onClick={() => follow.mutate(title)}>
                      <Plus size={14} /><span className="btn-label">{tr("Add")}</span>
                    </button>
                    <button
                      className="btn btn-sm badge-glass"
                      style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                      title={tr(isIgnored(title.tmdb_id, "movie") ? "Un-ignore — show in suggestions again" : "Ignore — hide from suggestions")}
                      onClick={() => (isIgnored(title.tmdb_id, "movie") ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                    >
                      {isIgnored(title.tmdb_id, "movie") ? <><Eye size={14} /><span className="btn-label">{tr("Un-ignore")}</span></> : <><EyeOff size={14} /><span className="btn-label">{tr("Ignore")}</span></>}
                    </button>
                  </>
                )}
                <button className="btn btn-icon badge-glass" style={{ color: "#fff" }} aria-label={tr("Close")} onClick={onClose}>
                  <X size={18} />
                </button>
              </div>

              <div className="detail-hero-foot">
                <div
                  className={`poster detail-poster${poster ? " zoomable" : ""}`}
                  role={poster ? "button" : undefined}
                  tabIndex={poster ? 0 : undefined}
                  aria-label={poster ? tr("View poster") : undefined}
                  onClick={poster ? () => setPosterOpen(true) : undefined}
                  onKeyDown={poster ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPosterOpen(true); } } : undefined}
                  style={{ background: posterBg(title.name + "x") }}
                >
                  {poster && <img className="poster-img" src={poster} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0 flex-1">
                  {/* Dónde verla vive AQUÍ y en ningún otro sitio: son los
                      mismos logotipos que en la ficha de un juego llevan las
                      consolas, junto al título. */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <WatchOn tmdbId={title.tmdb_id} kind="movie" size={12} />
                    {!released && (
                      <span className="badge badge-accent">
                        {title.first_air_date ? `${tr("Premieres ")}${fmtPlainDate(title.first_air_date)}` : tr("Announced")}
                      </span>
                    )}
                  </div>
                  <h2 className="detail-title">{displayName}</h2>
                  <div className="detail-meta">
                    {[
                      title.first_air_date?.slice(0, 4) ?? tr("TBA"),
                      title.genres.map(tGenre).join(" · "),
                      title.episode_run_time ? `${title.episode_run_time} ${tr("min")}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  {originalTitle && (
                    <div className="detail-orig">{tr("Original title")}: {originalTitle}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Cuerpo, en una sola columna */}
            <div className="detail-body">
              {/* Las notas y, entre las tuyas y las de fuera, el único acto que
                  tiene una película: verla. Tenía tarjeta propia y no daba para
                  ella — una fila con un botón y nada más.

                  De fuera hay UNA nota, IMDb con TMDB de reserva: es la que se
                  cita de una película, y dos números que casi nunca coinciden
                  no informan, obligan a elegir. Sin el recuento de votos, que
                  hacía la fila más alta que en las otras dos fichas. */}
              <div className="detail-scores">
                <div className="detail-mine">
                  <span className="eyebrow" style={{ fontSize: 10.5 }}>{tr("My rating")}</span>
                  <RatingStars value={rating} size={28} onRate={(v) => rateTitle.mutate(v)} />
                </div>

                {/* Cuando ya está vista no dice «toca para desmarcar»: lo dice
                    la caja —marco de acento y una trama diagonal muy suave—,
                    porque es el único botón de las tres fichas que representa un
                    ESTADO cumplido y no una acción pendiente. */}
                {episodeId && (
                  <button
                    className={`btn detail-act${seen ? " movie-seen" : " btn-accent"}`}
                    disabled={markWatched.isPending || unmarkWatched.isPending}
                    onClick={() => (watchEventId ? unmarkWatched.mutate(watchEventId) : markWatched.mutate(episodeId))}
                  >
                    <Check size={16} />
                    {seen ? tr("Watched") : tr("Mark watched")}
                  </button>
                )}

                <div className="detail-others">
                  {amigos.length > 0 && (
                    <>
                      <button
                        className="detail-cell detail-friends"
                        aria-expanded={friendsOpen}
                        onClick={() => setFriendsOpen((v) => !v)}
                      >
                        <span className="eyebrow" style={{ fontSize: 10 }}>{tr("Friends")}</span>
                        <span className="detail-cellval">
                          <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                          {friendsAvg != null ? friendsAvg.toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) : "—"}
                          {friendsOpen ? <ChevronUp size={14} style={{ color: "var(--text-mute)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-mute)" }} />}
                        </span>
                      </button>
                      <span className="detail-others-sep" />
                    </>
                  )}
                  {score && (
                    title.imdb_id && score.source === "imdb" ? (
                      <a
                        className="detail-cell detail-out"
                        href={`https://www.imdb.com/title/${title.imdb_id}/`}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={title.imdb_votes != null ? tv("{votes} votes on IMDb", { votes: title.imdb_votes.toLocaleString(dateLocale()) }) : tr("View on IMDb")}
                      >
                        <span className="eyebrow" style={{ fontSize: 10 }}>{scoreLabel(score.source)}</span>
                        <span className="detail-cellval">
                          <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: scoreColor(score.source) }} />
                          {score.value.toFixed(1)}
                          <ExternalLink size={12} />
                        </span>
                      </a>
                    ) : (
                      <div className="detail-cell">
                        <span className="eyebrow" style={{ fontSize: 10 }}>{scoreLabel(score.source)}</span>
                        <span className="detail-cellval">
                          <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: scoreColor(score.source) }} />
                          {score.value.toFixed(1)}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Quién de los tuyos anda con ella, al desplegar su celda. */}
              {friendsOpen && (
                <FriendsOnTitle
                  kind="movie"
                  titleId={title.id}
                  episodeId={episodeId}
                  tmdbId={title.tmdb_id}
                  released={released}
                  onOpen={(id) => { onClose(); navigate(`/friend/${id}`); }}
                />
              )}

              <div className="detail-main">
                {displayOverview && (
                  <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{displayOverview}</p>
                )}

                {/* Dirección y guion, en la MISMA línea: son dos datos cortos
                    y en dos renglones parecían dos secciones. La dirección
                    enlaza; el guion no, porque un guionista repetido en la
                    línea —lo habitual: dirige y firma— daría dos enlaces al
                    mismo sitio en el mismo renglón. */}
                {(directors.length > 0 || writers.length > 0) && (
                  <div style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: -6 }}>
                    {directors.length > 0 && (
                      <>
                        <span className="dim">{directors.length > 1 ? tr("Directors") : tr("Director")}</span>
                        {" · "}
                        {directors.map((d, i) => (
                          <span key={d.id}>
                            {i > 0 && ", "}
                            <button className="person-link" onClick={() => openPerson(d.id)}>{d.name}</button>
                          </span>
                        ))}
                      </>
                    )}
                    {directors.length > 0 && writers.length > 0 && <span style={{ display: "inline-block", width: 16 }} />}
                    {writers.length > 0 && (
                      <>
                        <span className="dim">{tr("Writers")}</span>
                        {" · "}
                        {[...new Set(writers.map((w) => w.name))].join(", ")}
                      </>
                    )}
                  </div>
                )}

                {/* El tráiler, debajo de quién la hizo. Al pulsarlo se carga el
                    reproductor; hasta entonces es una imagen, como en la ficha
                    de un juego. */}
                {trailer && (
                  <Trailer videoId={trailer.video_id} name={trailer.name} portada={backdrop} />
                )}

                {cast.length > 0 && (
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Cast")}</div>
                    <CastRail people={cast.map(personaDelReparto)} onPick={openPerson} />
                  </div>
                )}

                {/* La saga — lo que en una serie es la lista de episodios. */}
                {saga && saga.parts.length > 1 && (
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>
                      {saga.collection?.name ?? tr("Collection")}
                    </div>
                    <SagaRow parts={saga.parts} current={tmdbId} />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* El cartel a tamaño completo, al pulsarlo en el héroe. */}
      {posterOpen && posterFull && (
        <Lightbox
          imagenes={[posterFull]}
          indice={0}
          onClose={() => setPosterOpen(false)}
          etiqueta={displayName ? `${displayName} — ${tr("View poster")}` : tr("View poster")}
        />
      )}
    </>
  );
}

/** Las entregas de la saga, con tu estado en cada una. Ese estado sale de tu
 *  propia biblioteca, no del servidor: la ruta /saga devuelve títulos a secas
 *  precisamente para no cruzar datos de nadie.
 *
 *  Cambiar de entrega reemplaza el parámetro en vez de apilarlo: recorrer una
 *  trilogía y luego querer volver a lo que estabas viendo no debería costar
 *  tres pasos de Atrás. */
function SagaRow({ parts, current }: { parts: TitleRow[]; current: number }) {
  const { data: movies = [] } = useMovieLibrary();
  const [, setSearchParams] = useSearchParams();
  const byTitleId = useMemo(() => new Map(movies.map((m) => [m.title_id, m])), [movies]);

  const openPart = (tmdbId: number) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("movie", String(tmdbId));
        return next;
      },
      { replace: true },
    );

  return (
    <div className="saga-row">
      {parts.map((p) => {
        const mine = byTitleId.get(p.id);
        const isCurrent = p.tmdb_id === current;
        const art = tmdbImg(p.poster_path, "w185");
        const name = (isEs() && p.name_es) || p.name;
        const state = isCurrent
          ? tr("This film")
          : mine?.status === "watched"
            ? tr("Watched")
            : mine
              ? tr("Not started")
              : null;
        return (
          <button
            key={p.id}
            type="button"
            className={`saga-card${isCurrent ? " on" : ""}`}
            onClick={() => !isCurrent && openPart(p.tmdb_id)}
            aria-current={isCurrent ? "true" : undefined}
            title={name}
          >
            <span className="saga-art" style={{ background: posterBg(p.name) }}>
              {art && <img src={art} alt="" loading="lazy" />}
              {mine?.status === "watched" && !isCurrent && (
                <span className="saga-tick"><Check size={12} strokeWidth={3} /></span>
              )}
            </span>
            <span className="saga-name truncate">{name}</span>
            <span className="saga-meta mute truncate">
              {[p.first_air_date?.slice(0, 4) ?? tr("TBA"), state].filter(Boolean).join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
