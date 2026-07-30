import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Bell, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Minus, Pause, Play, Plus, Star, User, X } from "lucide-react";
import { getCredits, tmdbImg } from "@/lib/tmdb";
import { fmtAirDate, fmtPlainDate } from "@/lib/region";
import { dateLocale, isEs, t as tr, tGenre, tv } from "@/lib/i18n";
import { useLibrary, useFollow, useUnfollow, useToggleNotify, useSetStopped } from "@/lib/library";
import { useIgnored, useIgnore, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings } from "@/lib/taste";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useMarkWatched, useUnmarkWatched, useMarkUpTo, useMarkSeries, useUndoMarks } from "@/lib/watch";
import type { SeasonRow, EpisodeRow, CastMember } from "@/lib/schemas";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
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

/* Interactive 5-star rating on a 1-10 scale (each half-star = 1 point). Hovering
   previews the score you'd set — the stars fill dimmed and the number shows the
   pending value; clicking commits it. */
function RatingStars({ value, onRate }: { value: number; onRate: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value; // 0-10
  const previewing = hover != null;
  return (
    <div className="flex items-center gap-2.5">
      <div className={`rating-stars${previewing ? " previewing" : ""}`} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((i) => {
          const pct = shown >= i * 2 ? 100 : shown >= i * 2 - 1 ? 50 : 0;
          return (
            <span key={i} className="rating-star">
              <Star size={24} strokeWidth={1.6} className="rating-star-bg" />
              <span className="rating-star-fg" style={{ width: `${pct}%` }}>
                <Star size={24} strokeWidth={0} fill="currentColor" />
              </span>
              <span className="rating-half left" onMouseEnter={() => setHover(i * 2 - 1)} onClick={() => onRate(i * 2 - 1)} />
              <span className="rating-half right" onMouseEnter={() => setHover(i * 2)} onClick={() => onRate(i * 2)} />
            </span>
          );
        })}
      </div>
      <span className={`rating-num${previewing ? " dim" : ""}`}>
        {shown ? `${shown}/10` : "—"}
      </span>
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

/* Top-billed cast on one scrollable row. Arrows float over the row's edges
   (hidden on touch, where you swipe) and only render when there's more to
   scroll on that side. */
function CastRail({ cast, onPick }: { cast: CastMember[]; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(update); // re-measure on every render (cast load / width change)
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="cast-rail">
      <div className="flex gap-3 overflow-x-auto no-scrollbar" ref={ref} onScroll={update} style={{ paddingBottom: 4 }}>
        {cast.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className="flex flex-col items-center gap-1.5"
            style={{ width: 96, flex: "0 0 auto", cursor: "pointer", textAlign: "center" }}
            title={c.name}
            onClick={() => onPick(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(c.id); }
            }}
          >
            <span
              className="grid place-items-center overflow-hidden"
              style={{
                width: 88, height: 88, borderRadius: "50%", background: "var(--surface-3)",
                border: "1px solid var(--border)", flex: "0 0 auto", color: "var(--text-dim)",
              }}
            >
              {tmdbImg(c.profile_path, "w180_and_h180_face") ? (
                <img
                  src={tmdbImg(c.profile_path, "w180_and_h180_face")}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <User size={32} />
              )}
            </span>
            <span className="truncate" style={{ fontSize: 12, fontWeight: 650, width: "100%" }}>{c.name}</span>
            {c.character && (
              <span className="mute truncate" style={{ fontSize: 11, width: "100%", marginTop: -4 }}>{c.character}</span>
            )}
          </div>
        ))}
      </div>
      {canL && (
        <button className="rail-arrow cast-edge left" onClick={() => nudge(-1)} aria-label={tr("Earlier cast")}>
          <ChevronLeft size={18} />
        </button>
      )}
      {canR && (
        <button className="rail-arrow cast-edge right" onClick={() => nudge(1)} aria-label={tr("More cast")}>
          <ChevronRight size={18} />
        </button>
      )}
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
  const toggleNotify = useToggleNotify();
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
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const friendsRef = useRef<HTMLDivElement | null>(null);

  // Dropdown niceties: click-away closes it, Escape closes it before the sheet.
  useEffect(() => {
    if (!friendsOpen) return;
    const h = (e: PointerEvent) => {
      if (friendsRef.current && !friendsRef.current.contains(e.target as Node)) setFriendsOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [friendsOpen]);

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
      allFriendRatings.filter((r) => r.tmdb_id === tmdbId).map((r) => [r.user_id, r.score]),
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
      else if (friendsOpen) setFriendsOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, friendsOpen, posterOpen, episodeOpen]);

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
                  role={poster ? "button" : undefined}
                  tabIndex={poster ? 0 : undefined}
                  aria-label={poster ? tr("View poster") : undefined}
                  onClick={poster ? () => setPosterOpen(true) : undefined}
                  onKeyDown={poster ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPosterOpen(true); } } : undefined}
                  style={{ width: 96, height: 144, flex: "0 0 auto", background: posterBg(title.name + "x"), cursor: poster ? "zoom-in" : undefined }}
                >
                  {poster && <img className="poster-img" src={poster} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <WatchOn tmdbId={title.tmdb_id} size={12} />
                    {isUpcoming && (
                      <span className="badge badge-accent">
                        {title.first_air_date ? `${tr("Premieres ")}${fmtPlainDate(title.first_air_date)}` : tr("Announced")}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: 26, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)", color: "#fff", margin: 0 }}>
                    {displayName}
                  </h2>
                  <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.85)" }}>
                    {[title.first_air_date?.slice(0, 4) ?? tr("TBA"), title.genres.map(tGenre).join(" · "), title.episode_run_time ? `${title.episode_run_time} min` : null]
                      .filter(Boolean)
                      .join(" · ")}
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
              {/* Up next — the first pending episode, one tap to mark it seen.
                  Marking auto-follows the title, so it also shows on unfollowed
                  shows; a stopped show keeps its explicit pause instead. */}
              {nextPending && !entry?.stopped && (
                <div className="flex justify-center">
                  <button
                    className="btn btn-accent"
                    disabled={markWatched.isPending}
                    onClick={() => markWatched.mutate(nextPending.id)}
                    title={nextPending.name ?? undefined}
                  >
                    <Check size={16} />
                    {tr("Mark watched")} · S{nextPending.season_number} E{nextPending.episode_number}
                  </button>
                </div>
              )}

              {/* Actions — one balanced line, every button sharing the width */}
              <div className="action-row">
                <button className={`btn ${added ? "btn-outline" : "btn-accent"}`} onClick={toggleFollow}>
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
                {added && entry && isUpcoming && !entry.stopped && (
                  <button
                    className={`btn ${entry.notify ? "btn-accent" : "btn-outline"}`}
                    onClick={() => toggleNotify.mutate({ titleId: entry.title_id, notify: !entry.notify })}
                  >
                    <Bell size={16} />{entry.notify ? tr("Tracking") : tr("Notify me")}
                  </button>
                )}
                {added && entry && (
                  <button
                    className="btn btn-outline"
                    onClick={() => setStopped.mutate({ titleId: entry.title_id, stopped: !entry.stopped })}
                    title={tr(entry.stopped ? "Resume — back in Tonight & calendar" : "Stop watching — keeps history, hides from Tonight")}
                  >
                    {entry.stopped ? <><Play size={16} />{tr("Resume")}</> : <><Pause size={16} />{tr("Stop")}</>}
                  </button>
                )}
                {unwatchedAired > 0 && (
                  <button
                    className="btn btn-outline"
                    disabled={markSeries.isPending}
                    onClick={markWholeSeries}
                    title={unwatchedAired === 1
                      ? tr("Mark the last aired episode as seen — for shows you've already watched")
                      : tv("Mark all {count} aired episodes as seen — for shows you've already watched", { count: unwatchedAired })}
                  >
                    <CheckCheck size={16} />{markSeries.isPending ? tr("Marking…") : tr("All watched")}
                  </button>
                )}
              </div>

              {/* Ratings — own balanced line: yours | TMDB | IMDb | friends.
                  Four cells can't share a phone line, so that case reflows to a
                  2×2 grid (ratings-row-grid). IMDb rides along only once OMDb has
                  resolved a score for the show. */}
              <div className={`ratings-row${2 + (title.imdb_rating != null ? 1 : 0) + (friendsAvg != null ? 1 : 0) >= 4 ? " ratings-row-grid" : ""}`}>
                <div className="ratings-cell">
                  <div className="eyebrow">{tr("Your rating")}</div>
                  <RatingStars value={rating} onRate={(v) => rateTitle.mutate(v)} />
                </div>
                <div className="ratings-divider" />
                <div className="ratings-cell">
                  <div className="eyebrow">TMDB</div>
                  <div className="ratings-value">
                    <Star size={16} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                    <span>{title.vote_average ? title.vote_average.toFixed(1) : "—"}</span>
                  </div>
                </div>
                {title.imdb_rating != null && (
                  <>
                    <div className="ratings-divider" />
                    <div className="ratings-cell">
                      <div className="eyebrow">IMDb</div>
                      <div className="ratings-value" title={title.imdb_votes ? tv("{votes} votes on IMDb", { votes: title.imdb_votes.toLocaleString(dateLocale()) }) : undefined}>
                        <Star size={16} fill="currentColor" strokeWidth={0} style={{ color: "var(--imdb)" }} />
                        <span>{title.imdb_rating.toFixed(1)}</span>
                      </div>
                    </div>
                  </>
                )}
                {friendsAvg != null && (
                  <>
                    <div className="ratings-divider" />
                    <div className="relative" ref={friendsRef}>
                      <button
                        className="btn-reset friends-avg ratings-cell"
                        title={tr("Friend ratings")}
                        aria-haspopup="true"
                        aria-expanded={friendsOpen}
                        onClick={() => setFriendsOpen((o) => !o)}
                      >
                        <div className="eyebrow">{tr("Friends")}</div>
                        <div className="flex items-center justify-center gap-1.5">
                          <Star size={16} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                          <span style={{ fontWeight: 850, fontSize: 17 }}>{friendsAvg.toFixed(1)}</span>
                          <ChevronDown size={15} className="mute friends-avg-chev" aria-hidden />
                        </div>
                      </button>
                      {friendsOpen && (
                        <div className="card friends-pop" aria-label={tr("Friend ratings")}>
                          {friendRaters.map((r) => (
                            <div
                              key={r.id}
                              className="friends-pop-row"
                              role="button"
                              tabIndex={0}
                              title={tv("Open {name}'s profile", { name: r.name })}
                              onClick={() => { setFriendsOpen(false); onClose(); navigate(`/friend/${r.id}`); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFriendsOpen(false); onClose(); navigate(`/friend/${r.id}`); }
                              }}
                            >
                              <FriendAvatar f={r} size={26} />
                              <span className="flex-1 min-w-0 truncate" style={{ fontSize: 13, fontWeight: 650 }}>{r.name}</span>
                              <span className="flex items-center gap-1" style={{ fontWeight: 800, fontSize: 13 }}>
                                <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                                {r.score}/10
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {displayOverview && (
                <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{displayOverview}</p>
              )}

              {/* Cast — top billed; tapping an actor opens their page */}
              {cast.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Cast")}</div>
                  <CastRail cast={cast} onPick={(id) => { onClose(); navigate(`/person/${id}`); }} />
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
                              <span className="ep-title truncate">{e.name ?? `Episode ${e.episode_number}`}</span>
                              {e.imdb_rating != null && (
                                <span className="ep-imdb">
                                  <Star size={12} fill="currentColor" strokeWidth={0} />
                                  {e.imdb_rating.toFixed(1)}
                                </span>
                              )}
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

      {/* Full-size poster lightbox (poster click in the hero) */}
      {posterOpen && posterFull && (
        <>
          <div className="backdrop" style={{ zIndex: 90 }} onClick={() => setPosterOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={displayName ? `${displayName} — ${tr("View poster")}` : tr("View poster")}
            className="fixed"
            style={{ zIndex: 91, left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
          >
            <img
              src={posterFull}
              alt=""
              onClick={() => setPosterOpen(false)}
              style={{
                display: "block", maxWidth: "92vw", maxHeight: "88vh", cursor: "zoom-out",
                borderRadius: "var(--r-lg)", border: "1px solid var(--border)", boxShadow: "0 24px 80px rgba(0,0,0,.6)",
              }}
            />
            <button
              className="btn btn-icon badge-glass absolute"
              style={{ top: 10, right: 10, color: "#fff" }}
              aria-label={tr("Close")}
              onClick={() => setPosterOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        </>
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
