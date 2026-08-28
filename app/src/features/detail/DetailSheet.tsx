import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Check, CheckCheck, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Minus, Pause, Play, Plus, Star, X , ChevronDown, ChevronUp } from "lucide-react";
import { getCredits, tmdbImg } from "@/lib/tmdb";
import { fmtAirDate, fmtPlainDate } from "@/lib/region";
import { dateLocale, isEs, t as tr, tGenre, tv } from "@/lib/i18n";
import { useLibrary, useFollow, useUnfollow, useSetStopped } from "@/lib/library";
import { useIgnored, useIgnore, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings } from "@/lib/taste";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useMarkWatched, useUnmarkWatched, useMarkUpTo, useMarkSeries, useUndoMarks } from "@/lib/watch";
import type { SeasonRow, EpisodeRow } from "@/lib/schemas";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { Lightbox } from "@/ui/Lightbox";
import { CastRail } from "@/ui/CastRail";
import { personaDelReparto } from "@/ui/railPerson";
import { RatingStars } from "@/ui/RatingStars";
import {
  seasonQueryOptions,
  useTitle,
  useSeasonEpisodes,
  useWatched,
  useDetailProgress,
} from "@/features/detail/data";
import { EpisodeSheet } from "@/features/detail/EpisodeSheet";
import { SeasonChart } from "@/features/detail/SeasonChart";
import { hasChartableRatings } from "@/domain/episodeRatings";

/* Show detail sheet — port of prototype screens.tsx DetailSheet on live data.
   Opened globally via ?title=<tmdbId>; episode marking is wired in P2-C4 and
   rating persistence in P2-C5. */

/** Episode air_datetime for the dense list row — short form (no year) so the
 *  title keeps room next to the IMDb badge on a phone. The episode sub-sheet
 *  shows the full long date. */
const fmtDate = (iso: string | null) => (iso ? fmtAirDate(iso) : tr("TBA"));

function Skeleton() {
  return (
    <div className="overflow-y-auto p-6 flex flex-col gap-4">
      {[220, 60, 120].map((h, i) => (
        <div key={i} style={{ height: h }} className="skeleton" />
      ))}
    </div>
  );
}

function EpisodeSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label={tr("Loading episodes")}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 50 }} />
      ))}
    </div>
  );
}

/* Season picker: one pill per season on a single scrollable row, with arrows
   (opposite the label) that also nudge it — matches the rail arrows. */
function SeasonTabs({ seasons, active, onPick }: { seasons: SeasonRow[]; active: number | null; onPick: (n: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(update); // re-measure on every render (season list / active change)
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div>
      <div className="rail-head" style={{ marginBottom: 10 }}>
        <div className="eyebrow">{tr("Seasons")}</div>
        <div className="rail-nav">
          <button className="rail-arrow" onClick={() => nudge(-1)} disabled={!canL} aria-label={tr("Earlier seasons")}>
            <ChevronLeft size={18} />
          </button>
          <button className="rail-arrow" onClick={() => nudge(1)} disabled={!canR} aria-label={tr("Later seasons")}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="segmented scroll no-scrollbar" ref={ref} onScroll={update}>
        {seasons.map((s) => (
          <div key={s.number} className={`seg ${active === s.number ? "seg-active" : ""}`} onClick={() => onPick(s.number)}>
            {s.number}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSheet({ tmdbId, onClose }: { tmdbId: number; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending } = useTitle(tmdbId);
  const { data: library = [] } = useLibrary();
  const follow = useFollow();
  const unfollow = useUnfollow();
  const setStopped = useSetStopped();
  const { isIgnored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();
  const [season, setSeason] = useState<number | null>(null);

  const title = data?.title;
  const regularSeasons = (data?.seasons ?? []).filter((s: SeasonRow) => s.number > 0);
  const { data: watched } = useWatched(title?.id ?? null);
  const { data: progress, isPending: progressPending } = useDetailProgress(title?.id ?? null);
  // Which season to open on (a manual pick always wins):
  //  1. the season of the first aired-but-unwatched episode — where you'd pick up;
  //  2. if you're all caught up, the season of the next upcoming episode — so a
  //     show with a premiere on the way opens on its new season, not season 1;
  //  3. otherwise: season 1 if you've never watched the show (nothing cached
  //     yet to derive 1–2 from), or the latest season if you've seen it all.
  // Postgres returns the recommendation and per-season unseen counts in one
  // compact query, avoiding a download of every episode just for this choice.
  const firstSeason = regularSeasons[0]?.number ?? null;
  const activeSeason =
    season ??
    (!progressPending ? (progress?.recommended_season ?? firstSeason) : null);
  const { data: seasonData, isFetching: seasonFetching, isPlaceholderData } =
    useSeasonEpisodes(tmdbId, activeSeason, data);

  // Once the chosen season is visible, warm its immediate neighbours while
  // the browser is idle. Sequential browsing then feels instant without
  // pulling every season of a decades-long show or burning TMDB quota blindly.
  useEffect(() => {
    if (!data || activeSeason == null || !seasonData || seasonData.season.number !== activeSeason) return;
    const regular = data.seasons.filter((item) => item.number > 0);
    const index = regular.findIndex((item) => item.number === activeSeason);
    const neighbours = [regular[index - 1], regular[index + 1]].filter(Boolean);
    const timer = setTimeout(() => {
      for (const neighbour of neighbours) {
        void queryClient.prefetchQuery(seasonQueryOptions(tmdbId, neighbour.number, data));
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [activeSeason, data, queryClient, seasonData, tmdbId]);

  const titleId = title?.id ?? "";
  const { data: myRating } = useMyRating(title?.id ?? null);
  const rateTitle = useRateTitle(titleId);
  const rating = myRating ?? 0;
  const markWatched = useMarkWatched(titleId);
  const unmarkWatched = useUnmarkWatched(titleId);
  const markUpTo = useMarkUpTo(titleId);
  const markSeries = useMarkSeries(titleId);
  const undoMarks = useUndoMarks(titleId);
  const [pending, setPending] = useState<EpisodeRow | null>(null);
  const [episodeOpen, setEpisodeOpen] = useState<EpisodeRow | null>(null);
  const [toast, setToast] = useState<{ ids: string[]; count: number } | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  /* La lista de amigos vive plegada tras su nota: la media responde
     «¿está bien?» y solo si quieres saber quién, se abre. */
  const [friendsOpen, setFriendsOpen] = useState(false);


  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const nowIso = new Date().toISOString();
  const episodes = seasonData?.episodes ?? [];

  // First aired-but-unwatched episode, for the prominent "mark watched" button.
  // recommended_season is that episode's season whenever something is pending
  // (unwatched_aired > 0), so one season fetch — shared with the episode list
  // when it's the season on screen — is enough to pin down the exact episode.
  // Cold titles (never followed) have no episodes ingested yet, so the RPC
  // reports nothing pending; with no watch history the first pending episode
  // is simply the first aired one of season 1, known client-side.
  const pendingSeasonNum =
    (progress?.unwatched_aired ?? 0) > 0
      ? (progress?.recommended_season ?? null)
      : watched && watched.size === 0
        ? firstSeason
        : null;
  const { data: pendingSeasonData } = useSeasonEpisodes(tmdbId, pendingSeasonNum, data);
  const nextPending =
    pendingSeasonNum != null &&
    pendingSeasonData?.season.number === pendingSeasonNum &&
    watched
      ? pendingSeasonData.episodes.find(
          (e) => e.air_datetime && e.air_datetime <= nowIso && !watched.has(e.id),
        ) ?? null
      : null;
  const changingSeason = Boolean(
    isPlaceholderData ||
    (activeSeason != null && seasonData && seasonData.season.number !== activeSeason),
  );

  /** Aired, unwatched, regular-season episodes strictly before the target. */
  const unseenPriors = (e: EpisodeRow) => {
    const beforeSeason = progress?.unseen_before[String(e.season_number)] ?? 0;
    const earlierInSeason = episodes.filter(
      (x) =>
        x.air_datetime != null &&
        x.air_datetime <= nowIso &&
        x.episode_number < e.episode_number &&
        !watched?.has(x.id),
    ).length;
    return beforeSeason + earlierInSeason;
  };

  const onEpClick = (e: EpisodeRow) => {
    const aired = Boolean(e.air_datetime && e.air_datetime <= nowIso);
    if (!aired) return;
    const eventId = watched?.get(e.id);
    if (eventId) {
      if (eventId !== "optimistic") unmarkWatched.mutate(eventId);
      return;
    }
    if (unseenPriors(e) > 0) setPending(e);
    else markWatched.mutate(e.id);
  };

  const confirmMarkUpTo = async (e: EpisodeRow) => {
    setPending(null);
    const ids = await markUpTo.mutateAsync(e.id);
    setToast({ ids, count: ids.length });
  };

  const markWholeSeries = async () => {
    const ids = await markSeries.mutateAsync();
    setToast({ ids, count: ids.length });
  };
  const unwatchedAired = progress?.unwatched_aired ?? 0;

  /* El episodio por el que sigues, con su cara. `nextPending` sale de la
     temporada recomendada, así que su fotograma y su nombre traducido ya están
     en la fila — no hace falta pedir nada. */
  const nextStill = tmdbImg(nextPending?.still_path ?? null, "w342");
  const nextPendingName = nextPending
    ? ((isEs() && nextPending.name_es) || nextPending.name || tv("Episode {n}", { n: nextPending.episode_number }))
    : "";

  /* Las dos barras. La de la temporada se cuenta de la lista que ya está en
     pantalla; la de la serie sale del rollup de la biblioteca (aired_count /
     watched_count), que es quien lleva esa cuenta para toda la app — recontarla
     aquí a mano daría un número distinto al de la carátula. */

  // Every accepted friend's rating for this show (shares the taste page's
  // one-round-trip ratings query; the friend-read RLS scopes the rows).
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
      allFriendRatings.filter((r) => r.kind === "tv" && r.tmdb_id === tmdbId).map((r) => [r.user_id, r.score]),
    );
    return acceptedFriends
      .filter((f) => scores.has(f.other_id))
      .map((f) => ({ id: f.other_id, name: f.display_name, avatarUrl: f.avatar_url, score: scores.get(f.other_id)! }))
      .sort((a, b) => b.score - a.score);
  }, [acceptedFriends, allFriendRatings, tmdbId]);
  const friendsAvg = friendRaters.length
    ? friendRaters.reduce((sum, r) => sum + r.score, 0) / friendRaters.length
    : null;

  // Top-billed cast (proxy /credits) — best-effort, hidden while loading/failed.
  const { data: cast = [] } = useQuery({
    queryKey: ["credits", tmdbId],
    enabled: Boolean(title),
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => getCredits(tmdbId),
  });

  const entry = library.find((r) => r.tmdb_id === tmdbId);
  const added = Boolean(entry);
  /* La barra de toda la serie sale del rollup de la biblioteca, que es quien
     lleva esa cuenta para el resto de la app — recontarla aquí daría un número
     distinto al de la carátula. */
  const isUpcoming = !title?.first_air_date || title.first_air_date > new Date().toISOString().slice(0, 10);
  const displayName = title ? (isEs() && title.name_es) || title.name : "";
  const displayOverview = title ? (isEs() && title.overview_es) || title.overview : null;
  const originalTitle =
    title?.original_name && title.original_name !== displayName ? title.original_name : null;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (posterOpen) setPosterOpen(false);
      else if (episodeOpen) setEpisodeOpen(null);
      else onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, posterOpen, episodeOpen]);

  const toggleFollow = () => {
    if (!title) return;
    if (added && entry) unfollow.mutate(entry.title_id);
    else follow.mutate(title);
  };

  const backdrop = tmdbImg(title?.backdrop_path ?? null, "w780");
  const poster = tmdbImg(title?.poster_path ?? null, "w342");
  const posterFull = tmdbImg(title?.poster_path ?? null, "w780");
  const now = new Date().toISOString();

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? tv("{name} details", { name: displayName }) : tr("Show details")}
        tabIndex={-1}
        className="detail-sheet sheet-center fixed z-[70] card overflow-hidden flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(760px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
        }}
      >
        {isPending || !title ? (
          <Skeleton />
        ) : (
          <>
            {/* Héroe */}
            <div
              className="relative detail-hero"
              style={{ background: backdrop ? `url(${backdrop}) center/cover` : posterBg(title.name) }}
            >
              <div className="poster-sheen" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
              {/* Las acciones de gestión, agrupadas con la de salir. Aquí está
                  también la de dar la serie entera por vista: es un acto raro y
                  definitivo, y en el cuerpo se pasaba el día ocupando sitio. */}
              <div className="detail-hero-actions">
                {added && entry ? (
                  <>
                    <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }} onClick={toggleFollow}>
                      <Minus size={14} /><span className="btn-label">{tr("Remove")}</span>
                    </button>
                    <button
                      className="btn btn-sm badge-glass"
                      style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                      title={tr(entry.stopped ? "Resume — back in Tonight & calendar" : "Stop watching — keeps history, hides from Tonight")}
                      onClick={() => setStopped.mutate({ titleId: entry.title_id, stopped: !entry.stopped })}
                    >
                      {entry.stopped
                        ? <><Play size={14} /><span className="btn-label">{tr("Resume")}</span></>
                        : <><Pause size={14} /><span className="btn-label">{tr("Stop")}</span></>}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }} onClick={toggleFollow}>
                      <Plus size={14} /><span className="btn-label">{tr("Add")}</span>
                    </button>
                    <button
                      className="btn btn-sm badge-glass"
                      style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                      title={tr(isIgnored(title.tmdb_id, "tv") ? "Un-ignore — show in suggestions again" : "Ignore — hide from suggestions")}
                      onClick={() => (isIgnored(title.tmdb_id, "tv") ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                    >
                      {isIgnored(title.tmdb_id, "tv")
                        ? <><Eye size={14} /><span className="btn-label">{tr("Un-ignore")}</span></>
                        : <><EyeOff size={14} /><span className="btn-label">{tr("Ignore")}</span></>}
                    </button>
                  </>
                )}
                {unwatchedAired > 0 && (
                  <button
                    className="btn btn-sm badge-glass"
                    style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                    disabled={markSeries.isPending}
                    onClick={markWholeSeries}
                    title={unwatchedAired === 1
                      ? tr("Mark the last aired episode as seen — for shows you've already watched")
                      : tv("Mark all {count} aired episodes as seen — for shows you've already watched", { count: unwatchedAired })}
                  >
                    <CheckCheck size={14} /><span className="btn-label">{markSeries.isPending ? tr("Marking…") : tr("All watched")}</span>
                  </button>
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
                  <div className="flex items-center gap-2 mb-1.5">
                    <WatchOn tmdbId={title.tmdb_id} size={12} />
                    {isUpcoming && (
                      <span className="badge badge-accent">
                        {title.first_air_date ? `${tr("Premieres ")}${fmtPlainDate(title.first_air_date)}` : tr("Announced")}
                      </span>
                    )}
                  </div>
                  <h2 className="detail-title">{displayName}</h2>
                  <div className="detail-meta">
                    {[title.first_air_date?.slice(0, 4) ?? tr("TBA"), title.genres.map(tGenre).join(" · "), title.episode_run_time ? `${title.episode_run_time} min` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {originalTitle && (
                    <div className="detail-orig">{tr("Original title")}: {originalTitle}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Cuerpo, en una sola columna */}
            <div className="detail-body">
              {/* Las notas, sobre el fondo y no en una tarjeta. La tuya manda:
                  se pone, no se lee, y por eso lleva las estrellas grandes. Las
                  de fuera van juntas a la derecha, con la de tus amigos a su
                  izquierda — puede no haber ninguno, y así lo que falta encoge
                  por dentro de la caja en vez de dejar un hueco. */}
              <div className="detail-scores">
                <div className="detail-mine">
                  <span className="eyebrow" style={{ fontSize: 10.5 }}>{tr("My rating")}</span>
                  <RatingStars value={rating} size={28} onRate={(v) => rateTitle.mutate(v)} />
                </div>
                <div className="detail-others">
                  {friendsAvg != null && (
                    <>
                      <button
                        className="detail-cell detail-friends"
                        aria-expanded={friendsOpen}
                        onClick={() => setFriendsOpen((v) => !v)}
                      >
                        <span className="eyebrow" style={{ fontSize: 10 }}>{tr("Friends")}</span>
                        <span className="detail-cellval">
                          <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                          {friendsAvg.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })}
                          {friendsOpen ? <ChevronUp size={14} style={{ color: "var(--text-mute)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-mute)" }} />}
                        </span>
                      </button>
                      <span className="detail-others-sep" />
                    </>
                  )}
                  <div className="detail-cell">
                    <span className="eyebrow" style={{ fontSize: 10 }}>TMDB</span>
                    <span className="detail-cellval">
                      <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                      {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                    </span>
                  </div>
                  <span className="detail-others-sep" />
                  {/* La celda de IMDb ES el enlace, con su flecha: un botón
                      aparte para lo mismo era una cosa más que leer. Sin tconst
                      no hay a dónde ir y se queda en número. */}
                  {title.imdb_id ? (
                    <a
                      className="detail-cell detail-out"
                      href={`https://www.imdb.com/title/${title.imdb_id}/`}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={title.imdb_votes ? tv("{votes} votes on IMDb", { votes: title.imdb_votes.toLocaleString(dateLocale()) }) : tr("View on IMDb")}
                    >
                      <span className="eyebrow" style={{ fontSize: 10 }}>IMDb</span>
                      <span className="detail-cellval">
                        <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--imdb)" }} />
                        {title.imdb_rating != null ? title.imdb_rating.toFixed(1) : "—"}
                        <ExternalLink size={12} />
                      </span>
                    </a>
                  ) : (
                    <div className="detail-cell">
                      <span className="eyebrow" style={{ fontSize: 10 }}>IMDb</span>
                      <span className="detail-cellval">
                        <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--imdb)" }} />
                        {title.imdb_rating != null ? title.imdb_rating.toFixed(1) : "—"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quién de los tuyos la ha puntuado, al desplegar su celda. */}
              {friendsOpen && friendRaters.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="eyebrow">{tr("Friends")}</span>
                    {friendsAvg != null && (
                      <span className="friends-title-score">
                        <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                        {friendsAvg.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="card friends-title-list">
                    {friendRaters.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="btn-reset friends-title-row"
                        title={tv("Open {name}'s profile", { name: r.name })}
                        onClick={() => { onClose(); navigate(`/friend/${r.id}`); }}
                      >
                        <FriendAvatar f={r} size={26} />
                        <span className="friends-title-name">{r.name}</span>
                        <span className="friends-title-score">
                          <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                          {r.score}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Por dónde ibas: el fotograma, qué episodio es y el botón. Es
                  lo que se viene a hacer, así que va lo primero del cuerpo. */}
              {nextPending && !entry?.stopped && (
                <div className="card detail-next">
                  {/* El fotograma y el texto abren la ficha del episodio —la
                      misma que la fila de la lista—, que es donde está la
                      sinopsis. El botón de marcar se queda aparte: son dos
                      intenciones distintas y compartir clic las confundía. */}
                  <button
                    type="button"
                    className="btn-reset detail-next-open"
                    onClick={() => setEpisodeOpen(nextPending)}
                    title={tr("Episode details")}
                  >
                    <img
                      className="detail-next-still"
                      src={nextStill ?? undefined}
                      alt=""
                      style={nextStill ? undefined : { background: posterBg(title.name) }}
                    />
                    <span className="detail-next-txt">
                      <span className="detail-next-se">
                        S{nextPending.season_number} · E{nextPending.episode_number} · {tr("Continue with")}
                      </span>
                      <span className="detail-next-name truncate">{nextPendingName}</span>
                      <span className="detail-next-date">{fmtDate(nextPending.air_datetime)}</span>
                    </span>
                  </button>
                  <button
                    className="btn btn-accent btn-sm"
                    disabled={markWatched.isPending}
                    onClick={() => markWatched.mutate(nextPending.id)}
                    title={nextPending.name ?? undefined}
                  >
                    <Check size={15} />{tr("Mark watched")}
                  </button>
                </div>
              )}

              <div className="detail-main">
                {displayOverview && (
                  <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{displayOverview}</p>
                )}
                {/* La ficha, en una línea: no da para un bloque con rótulos y
                    a la vez es lo que se mira cuando alguien dice "¿de qué
                    cadena era?". */}
                <div className="mute" style={{ fontSize: 12.5, marginTop: -8 }}>
                  {[
                    title.network,
                    title.status,
                    title.first_air_date ? `${tr("Premieres ")}${fmtPlainDate(title.first_air_date)}` : null,
                  ].filter(Boolean).join(" · ")}
                </div>

              {/* Cast — top billed; tapping an actor opens their page */}
              {cast.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Cast")}</div>
                  <CastRail people={cast.map(personaDelReparto)} onPick={(id) => { onClose(); navigate(`/person/${id}`); }} />
                </div>
              )}

              {/* Episodes */}
              {regularSeasons.length > 0 && (
                <div>
                  <SeasonTabs seasons={regularSeasons} active={activeSeason} onPick={setSeason} />
                  {/* IMDb episode-rating graph for the chosen season, above its
                      episode list. Needs enough rated episodes to mean anything
                      (hasChartableRatings — a currently-airing season starts with
                      one rated episode, and a lone dot read as "one episode");
                      dims with the list while switching seasons. */}
                  {hasChartableRatings(episodes) && (
                    <div
                      style={{ margin: "14px 0 4px", opacity: changingSeason ? 0.45 : 1, transition: "opacity .15s ease" }}
                      aria-busy={changingSeason}
                    >
                      <SeasonChart episodes={episodes} onPick={setEpisodeOpen} />
                    </div>
                  )}
                  <div style={{ position: "relative", minHeight: episodes.length ? undefined : 310 }}>
                    {episodes.length === 0 && seasonFetching && <EpisodeSkeleton />}
                    {episodes.length === 0 && !seasonFetching && (
                      <div className="dim" style={{ fontSize: 13.5, padding: "12px 0" }}>{tr("No episodes available yet.")}</div>
                    )}
                    <div
                      className="flex flex-col"
                      aria-busy={changingSeason}
                      style={{
                        opacity: changingSeason ? 0.45 : 1,
                        pointerEvents: changingSeason ? "none" : undefined,
                        transition: "opacity .15s ease",
                      }}
                    >
                      {episodes.map((e) => {
                        const aired = Boolean(e.air_datetime && e.air_datetime <= now);
                        const isWatched = watched?.has(e.id) ?? false;
                        return (
                          <div key={e.id} className={`ep-row${aired ? "" : " ep-unaired"}`}>
                            {/* The check is now the only watched toggle; the rest
                                of the row opens the episode sub-sheet. */}
                            <button
                              className={`check ${isWatched ? "on" : ""}`}
                              disabled={!aired}
                              aria-label={
                                isWatched
                                  ? tr("Watched — tap to clear")
                                  : tv("Mark {name} {se} watched", { name: displayName, se: `S${e.season_number}·E${e.episode_number}` })
                              }
                              onClick={() => onEpClick(e)}
                            >
                              <Check size={15} strokeWidth={3} />
                            </button>
                            <button className="ep-main" onClick={() => setEpisodeOpen(e)} title={e.name ?? undefined}>
                              <span className="ep-num">E{e.episode_number}</span>
                              <span className="ep-title truncate">{(isEs() && e.name_es) || e.name || `Episode ${e.episode_number}`}</span>
                              {/* Always rendered, empty when unrated: the score
                                  and date columns must not collapse, or the rows
                                  around a missing one shift out of line. */}
                              <span className="ep-imdb">
                                {e.imdb_rating != null && (
                                  <>
                                    <Star size={12} fill="currentColor" strokeWidth={0} />
                                    {/* Its own element, so the star and the
                                        number each get a fixed grid column and
                                        line up down the list. */}
                                    <span>{e.imdb_rating.toFixed(1)}</span>
                                  </>
                                )}
                              </span>
                              {/* La de TMDB, que la ficha ancha sí puede
                                  enseñar. Misma regla que la de IMDb: la celda
                                  se pinta siempre, vacía cuando no hay, o las
                                  columnas de las filas de al lado bailan. */}
                              <span className="ep-tmdb">
                                {e.tmdb_vote_average ? e.tmdb_vote_average.toFixed(1) : ""}
                              </span>
                              <span className="ep-date">{fmtDate(e.air_datetime)}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* "Mark all up to here" confirmation */}
      {pending && (
        <>
          <div className="backdrop" style={{ zIndex: 80 }} onClick={() => setPending(null)} />
          <div
            className="sheet-center fixed card flex flex-col"
            style={{ zIndex: 81, left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(400px, 92vw)", padding: 22, gap: 6, borderRadius: "var(--r-lg)" }}
          >
            <div style={{ fontWeight: 800, fontSize: 16 }}>{tr("Mark earlier episodes as seen?")}</div>
            <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: "2px 0 14px" }}>
              {tv(
                unseenPriors(pending) === 1
                  ? "You still have {count} unwatched episode up to S{season} · E{episode}. Mark them all as seen?"
                  : "You still have {count} unwatched episodes up to S{season} · E{episode}. Mark them all as seen?",
                { count: unseenPriors(pending), season: pending.season_number, episode: pending.episode_number },
              )}
            </p>
            <div className="flex items-center gap-2.5">
              <button className="btn btn-accent flex-1" onClick={() => confirmMarkUpTo(pending)}>
                <Check size={16} />{tr("Mark all")} {unseenPriors(pending) + 1}
              </button>
              <button
                className="btn btn-outline flex-1"
                onClick={() => { markWatched.mutate(pending.id); setPending(null); }}
              >
                {tr("Only this one")}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Episode sub-sheet — synopsis + per-episode scores (TMDB · IMDb) +
          mark-watched. Toggles this one episode only; the list's check keeps the
          "mark all up to here" prompt. */}
      {episodeOpen && (() => {
        const epAired = Boolean(episodeOpen.air_datetime && episodeOpen.air_datetime <= now);
        const eventId = watched?.get(episodeOpen.id);
        const isW = Boolean(eventId);
        return (
          <EpisodeSheet
            episode={episodeOpen}
            onPickPerson={(id) => { onClose(); navigate(`/person/${id}`); }}
            aired={epAired}
            watched={isW}
            busy={markWatched.isPending || unmarkWatched.isPending}
            onToggleWatched={() => {
              if (isW) {
                if (eventId && eventId !== "optimistic") unmarkWatched.mutate(eventId);
              } else {
                markWatched.mutate(episodeOpen.id);
              }
            }}
            onClose={() => setEpisodeOpen(null)}
          />
        );
      })()}

      {/* El cartel a tamaño completo, al pulsarlo en el héroe. */}
      {posterOpen && posterFull && (
        <Lightbox
          imagenes={[posterFull]}
          indice={0}
          onClose={() => setPosterOpen(false)}
          etiqueta={displayName ? `${displayName} — ${tr("View poster")}` : tr("View poster")}
        />
      )}

      {/* Undo toast after a bulk mark */}
      {toast && (
        <div
          className="card sheet fixed flex items-center gap-3"
          style={{ zIndex: 85, left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "12px 16px", borderRadius: 999 }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 650 }}>
            {tv(toast.count === 1 ? "Marked {count} episode as seen" : "Marked {count} episodes as seen", { count: toast.count })}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { undoMarks.mutate(toast.ids); setToast(null); }}
          >
            {tr("Undo")}
          </button>
        </div>
      )}
    </>
  );
}
