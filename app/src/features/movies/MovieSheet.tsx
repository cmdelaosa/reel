import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { Check, Eye, EyeOff, Minus, Plus, Star, X } from "lucide-react";
import { getMovie, getMovieCredits, getMovieSaga, tmdbImg } from "@/lib/tmdb";
import { qk } from "@/lib/queryKeys";
import { fmtPlainDate } from "@/lib/region";
import { dateLocale, isEs, t as tr, tGenre, tv } from "@/lib/i18n";
import { useFollow, useMovieLibrary, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings } from "@/lib/taste";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { useWatched } from "@/features/detail/data";
import type { TitleRow } from "@/lib/schemas";
import { externalScore, scoreColor, scoreLabel } from "@/domain/externalScore";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { CastRail } from "@/ui/CastRail";
import { RatingStars } from "@/ui/RatingStars";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";

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

  const { data: friendships = [] } = useFriendships();
  const acceptedFriends = useMemo(
    () => friendships.filter((f) => f.status === "accepted"),
    [friendships],
  );
  const { data: allFriendRatings = [] } = useFriendsRatings(
    useMemo(() => acceptedFriends.map((f) => f.other_id), [acceptedFriends]),
  );
  const friendRaters = useMemo(() => {
    const scores = new Map(
      allFriendRatings
        .filter((r) => r.kind === "movie" && r.tmdb_id === tmdbId)
        .map((r) => [r.user_id, r.score]),
    );
    return acceptedFriends
      .filter((f) => scores.has(f.other_id))
      .map((f) => ({ id: f.other_id, name: f.display_name, avatarUrl: f.avatar_url, score: scores.get(f.other_id)! }))
      .sort((a, b) => b.score - a.score);
  }, [acceptedFriends, allFriendRatings, tmdbId]);
  const friendsAvg = friendRaters.length
    ? friendRaters.reduce((sum, r) => sum + r.score, 0) / friendRaters.length
    : null;
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
  const backdrop = tmdbImg(title?.backdrop_path ?? null, "w780");
  const displayName = (isEs() && title?.name_es) || title?.name || "";
  const displayOverview = (isEs() && title?.overview_es) || title?.overview || "";
  const originalTitle =
    title?.original_name && title.original_name !== displayName ? title.original_name : null;
  const released = Boolean(title?.first_air_date && title.first_air_date <= new Date().toISOString().slice(0, 10));

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
            {/* Hero */}
            <div
              className="relative"
              style={{
                height: 200, flex: "0 0 auto",
                background: backdrop ? `url(${backdrop}) center/cover` : posterBg(title.name),
              }}
            >
              <div className="poster-sheen" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
              <button className="btn btn-icon badge-glass absolute" style={{ top: 14, right: 14, color: "#fff" }} onClick={onClose}>
                <X size={18} />
              </button>
              <div className="absolute flex items-end gap-4" style={{ left: 24, right: 24, bottom: 16 }}>
                <div
                  className="poster"
                  style={{ width: 96, height: 144, flex: "0 0 auto", background: posterBg(title.name + "x") }}
                >
                  {poster && <img className="poster-img" src={poster} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <WatchOn tmdbId={title.tmdb_id} kind="movie" size={12} />
                    {!released && (
                      <span className="badge badge-accent">
                        {title.first_air_date ? `${tr("Premieres ")}${fmtPlainDate(title.first_air_date)}` : tr("Announced")}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: 26, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)", color: "#fff", margin: 0 }}>
                    {displayName}
                  </h2>
                  <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.85)" }}>
                    {[
                      title.first_air_date?.slice(0, 4) ?? tr("TBA"),
                      title.genres.map(tGenre).join(" · "),
                      title.episode_run_time ? `${title.episode_run_time} ${tr("min")}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  {originalTitle && (
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.65)", marginTop: 2 }}>
                      {tr("Original title")}: {originalTitle}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-6 flex flex-col gap-6">
              {/* Un solo acto, un solo botón — el equivalente de la columna de
                  checks de una serie. Sin episode_id (una fila escrita
                  esquivando el trigger de 0067) no se dibuja, en vez de ofrecer
                  algo que fallaría. */}
              {episodeId && (
                <div className="flex justify-center">
                  <button
                    className={`btn ${seen ? "btn-outline" : "btn-accent"}`}
                    disabled={markWatched.isPending || unmarkWatched.isPending}
                    onClick={() => (watchEventId ? unmarkWatched.mutate(watchEventId) : markWatched.mutate(episodeId))}
                  >
                    <Check size={16} />
                    {seen ? tr("Watched — tap to clear") : tr("Mark watched")}
                  </button>
                </div>
              )}

              <div className="action-row">
                <button
                  className={`btn ${added ? "btn-outline" : "btn-accent"}`}
                  onClick={() => (added && entry ? unfollow.mutate(entry.title_id) : follow.mutate(title))}
                >
                  {added ? <><Minus size={16} />{tr("Remove")}</> : <><Plus size={16} />{tr("Add")}</>}
                </button>
                {!added && (
                  <button
                    className={`btn ${isIgnored(title.tmdb_id) ? "btn-accent" : "btn-outline"}`}
                    onClick={() => (isIgnored(title.tmdb_id) ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                    title={tr(isIgnored(title.tmdb_id) ? "Un-ignore — show in suggestions again" : "Ignore — hide from suggestions")}
                  >
                    {isIgnored(title.tmdb_id) ? <><Eye size={16} />{tr("Un-ignore")}</> : <><EyeOff size={16} />{tr("Ignore")}</>}
                  </button>
                )}
              </div>

              {/* Notas. A diferencia de una serie, aquí la nota ajena es UNA:
                  la de IMDb, que en cine es la que la gente cita, y la de TMDB
                  solo cuando IMDb no puntúa esta película (recién estrenada,
                  con cuatro votos, o sin tconst en TMDB). La regla y el color
                  salen de domain/externalScore; la etiqueta dice cuál de las
                  dos estás leyendo, que es lo que hace honesta la reserva.

                  Con una sola celda ajena la fila tiene tres como mucho, así
                  que no necesita la rejilla 2×2 que la de series usa cuando
                  tiene cuatro. */}
              <div className="ratings-row">
                <div className="ratings-cell">
                  <div className="eyebrow">{tr("Your rating")}</div>
                  <RatingStars value={rating} onRate={(v) => rateTitle.mutate(v)} />
                </div>
                {score && (
                  <>
                    <div className="ratings-divider" />
                    <div className="ratings-cell">
                      <div className="eyebrow">{scoreLabel(score.source)}</div>
                      <div
                        className="ratings-value"
                        title={
                          score.source === "imdb" && title.imdb_votes
                            ? tv("{votes} votes on IMDb", { votes: title.imdb_votes.toLocaleString(dateLocale()) })
                            : undefined
                        }
                      >
                        <Star size={16} fill="currentColor" strokeWidth={0} style={{ color: scoreColor(score.source) }} />
                        {score.value.toFixed(1)}
                      </div>
                    </div>
                  </>
                )}
                {friendsAvg != null && (
                  <>
                    <div className="ratings-divider" />
                    <div className="ratings-cell">
                      <div className="eyebrow">{tr("Friends")}</div>
                      <div className="flex items-center justify-center gap-1.5">
                        {friendRaters.slice(0, 3).map((r) => (
                          <FriendAvatar key={r.id} f={r} size={20} />
                        ))}
                        <span style={{ fontWeight: 850, fontSize: 17 }}>{friendsAvg.toFixed(1)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {displayOverview && (
                <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{displayOverview}</p>
              )}

              {/* Ficha técnica. La dirección enlaza; el guion no, porque un
                  guionista repetido en la línea (lo habitual: dirige y firma)
                  daría dos enlaces al mismo sitio en el mismo renglón. */}
              {(directors.length > 0 || writers.length > 0) && (
                <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                  {directors.length > 0 && (
                    <div>
                      <span className="dim">{directors.length > 1 ? tr("Directors") : tr("Director")}</span>
                      {" · "}
                      {directors.map((d, i) => (
                        <span key={d.id}>
                          {i > 0 && ", "}
                          <button className="person-link" onClick={() => openPerson(d.id)}>{d.name}</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {writers.length > 0 && (
                    <div>
                      <span className="dim">{tr("Writers")}</span>
                      {" · "}
                      {[...new Set(writers.map((w) => w.name))].join(", ")}
                    </div>
                  )}
                </div>
              )}

              {cast.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Cast")}</div>
                  <CastRail cast={cast} onPick={openPerson} />
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
          </>
        )}
      </div>
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
