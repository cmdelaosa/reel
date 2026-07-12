import { useEffect, useRef, useState } from "react";
import { Bell, Check, ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, Plus, Star, X } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { useLibrary, useFollow, useUnfollow, useToggleNotify, useSetStopped } from "@/lib/library";
import { useIgnored, useIgnore, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useMarkWatched, useUnmarkWatched, useMarkUpTo, useUndoMarks } from "@/lib/watch";
import type { SeasonRow, EpisodeRow } from "@/lib/schemas";
import { NetworkLogo } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { useTitle, useSeasonEpisodes, useWatched, useTitleEpisodes } from "@/features/detail/data";

/* Show detail sheet — port of prototype screens.tsx DetailSheet on live data.
   Opened globally via ?title=<tmdbId>; episode marking is wired in P2-C4 and
   rating persistence in P2-C5. */

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "TBA";

function Skeleton() {
  return (
    <div className="overflow-y-auto p-6 flex flex-col gap-4">
      {[220, 60, 120].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: "var(--r)", background: "var(--surface-2)" }} className="screen" />
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
      <span className={previewing ? "dim" : ""} style={{ fontWeight: 800, fontSize: 15, minWidth: 42 }}>
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
        <div className="eyebrow">Seasons</div>
        <div className="rail-nav">
          <button className="rail-arrow" onClick={() => nudge(-1)} disabled={!canL} aria-label="Earlier seasons">
            <ChevronLeft size={18} />
          </button>
          <button className="rail-arrow" onClick={() => nudge(1)} disabled={!canR} aria-label="Later seasons">
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
  const { data: watched, isPending: watchedPending } = useWatched(title?.id ?? null);
  const { data: allEpisodesData, isPending: allEpisodesPending } = useTitleEpisodes(title?.id ?? null);
  const allEpisodes = allEpisodesData ?? [];
  // Which season to open on (a manual pick always wins):
  //  1. the season of the first aired-but-unwatched episode — where you'd pick up;
  //  2. if you're all caught up, the season of the next upcoming episode — so a
  //     show with a premiere on the way opens on its new season, not season 1;
  //  3. otherwise: season 1 if you've never watched the show (nothing cached
  //     yet to derive 1–2 from), or the latest season if you've seen it all.
  // The choice waits for the two watch-history queries (fast DB reads that run
  // in parallel) so exactly one season is fetched — no last-season flash that
  // then jumps to where you left off.
  const nowIso0 = new Date().toISOString();
  const firstUnwatched = allEpisodes
    .filter((e) => e.season_number > 0 && e.air_datetime != null && e.air_datetime <= nowIso0 && !watched?.has(e.id))
    .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number)[0];
  const nextUpcoming = allEpisodes
    .filter((e) => e.season_number > 0 && e.air_datetime != null && e.air_datetime > nowIso0)
    .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number)[0];
  const firstSeason = regularSeasons[0]?.number ?? null;
  const lastSeason = regularSeasons[regularSeasons.length - 1]?.number ?? null;
  const historyReady = !watchedPending && !allEpisodesPending;
  const activeSeason =
    season ??
    (historyReady
      ? (firstUnwatched?.season_number ??
        nextUpcoming?.season_number ??
        (watched?.size ? lastSeason : firstSeason))
      : null);
  const { data: seasonData } = useSeasonEpisodes(tmdbId, activeSeason);

  const titleId = title?.id ?? "";
  const { data: myRating } = useMyRating(title?.id ?? null);
  const rateTitle = useRateTitle(titleId);
  const rating = myRating ?? 0;
  const markWatched = useMarkWatched(titleId);
  const unmarkWatched = useUnmarkWatched(titleId);
  const markUpTo = useMarkUpTo(titleId);
  const undoMarks = useUndoMarks(titleId);
  const [pending, setPending] = useState<EpisodeRow | null>(null);
  const [toast, setToast] = useState<{ ids: string[]; count: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const nowIso = new Date().toISOString();

  /** Aired, unwatched, regular-season episodes strictly before the target. */
  const unseenPriors = (e: EpisodeRow) =>
    allEpisodes.filter(
      (x) =>
        x.season_number > 0 &&
        x.air_datetime != null &&
        x.air_datetime <= nowIso &&
        (x.season_number < e.season_number ||
          (x.season_number === e.season_number && x.episode_number < e.episode_number)) &&
        !watched?.has(x.id),
    ).length;

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

  const entry = library.find((r) => r.tmdb_id === tmdbId);
  const added = Boolean(entry);
  const isUpcoming = !title?.first_air_date || title.first_air_date > new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const toggleFollow = () => {
    if (!title) return;
    if (added && entry) unfollow.mutate(entry.title_id);
    else follow.mutate(title);
  };

  const backdrop = tmdbImg(title?.backdrop_path ?? null, "w780");
  const poster = tmdbImg(title?.poster_path ?? null, "w342");
  const episodes = seasonData?.episodes ?? [];
  const now = new Date().toISOString();

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? `${title.name} details` : "Show details"}
        tabIndex={-1}
        className="sheet-center fixed z-[70] card overflow-hidden flex flex-col"
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
                <div className="poster" style={{ width: 96, height: 144, flex: "0 0 auto", background: posterBg(title.name + "x") }}>
                  {poster && <img className="poster-img" src={poster} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    {title.network && <NetworkLogo network={title.network} size={12} />}
                    {isUpcoming && (
                      <span className="badge badge-accent">
                        {title.first_air_date ? `Premieres ${fmtDate(title.first_air_date)}` : "Announced"}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: 26, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)", color: "#fff", margin: 0 }}>
                    {title.name}
                  </h2>
                  <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.85)" }}>
                    {[title.first_air_date?.slice(0, 4) ?? "TBA", title.genres.join(" · "), title.episode_run_time ? `${title.episode_run_time} min` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-6 flex flex-col gap-6">
              {/* Actions on the left, ratings tucked to the right at the same height */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button className={`btn ${added ? "btn-outline" : "btn-accent"}`} onClick={toggleFollow}>
                    {added ? <><Check size={16} />Remove</> : <><Plus size={16} />Add</>}
                  </button>
                  {!added && (
                    <button
                      className={`btn ${isIgnored(title.tmdb_id) ? "btn-accent" : "btn-outline"}`}
                      onClick={() => (isIgnored(title.tmdb_id) ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                      title={isIgnored(title.tmdb_id) ? "Un-ignore — show in suggestions again" : "Not interested — hide from suggestions"}
                    >
                      {isIgnored(title.tmdb_id) ? <><Eye size={16} />Un-ignore</> : <><EyeOff size={16} />Not interested</>}
                    </button>
                  )}
                  {added && entry && isUpcoming && !entry.stopped && (
                    <button
                      className={`btn ${entry.notify ? "btn-accent" : "btn-outline"}`}
                      onClick={() => toggleNotify.mutate({ titleId: entry.title_id, notify: !entry.notify })}
                    >
                      <Bell size={16} />{entry.notify ? "Tracking" : "Notify me"}
                    </button>
                  )}
                  {added && entry && (
                    <button
                      className="btn btn-outline"
                      onClick={() => setStopped.mutate({ titleId: entry.title_id, stopped: !entry.stopped })}
                      title={entry.stopped ? "Resume — back in Tonight & calendar" : "Stop watching — keeps history, hides from Tonight"}
                    >
                      {entry.stopped ? <><Play size={16} />Resume</> : <><Pause size={16} />Stop watching</>}
                    </button>
                  )}
                </div>

                {/* Ratings — yours (persisted in P2-C5) + TMDB community */}
                <div className="flex items-center gap-4">
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 5 }}>Your rating</div>
                    <RatingStars value={rating} onRate={(v) => rateTitle.mutate(v)} />
                  </div>
                  <div style={{ width: 1, height: 40, background: "var(--border)", flex: "0 0 auto" }} />
                  <div style={{ textAlign: "center" }}>
                    <div className="eyebrow" style={{ marginBottom: 5 }}>TMDB</div>
                    <div className="flex items-center justify-center gap-1.5">
                      <Star size={16} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                      <span style={{ fontWeight: 850, fontSize: 17 }}>
                        {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {title.overview && (
                <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{title.overview}</p>
              )}

              {/* Episodes */}
              {regularSeasons.length > 0 && (
                <div>
                  <SeasonTabs seasons={regularSeasons} active={activeSeason} onPick={setSeason} />
                  <div className="flex flex-col">
                    {episodes.length === 0 && (
                      <div className="dim" style={{ fontSize: 13.5, padding: "10px 0" }}>Loading episodes…</div>
                    )}
                    {episodes.map((e) => {
                      const aired = Boolean(e.air_datetime && e.air_datetime <= now);
                      const isWatched = watched?.has(e.id) ?? false;
                      return (
                        <div key={e.id} className="ep-row" style={aired ? undefined : { opacity: 0.55, cursor: "default" }} onClick={() => onEpClick(e)}>
                          <div className={`check ${isWatched ? "on" : ""}`}><Check size={15} strokeWidth={3} /></div>
                          <div className="mute" style={{ fontSize: 13, width: 42, flex: "0 0 auto" }}>E{e.episode_number}</div>
                          <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">{e.name ?? `Episode ${e.episode_number}`}</div>
                          </div>
                          <div className="mute" style={{ fontSize: 12 }}>{fmtDate(e.air_datetime)}</div>
                        </div>
                      );
                    })}
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
            <div style={{ fontWeight: 800, fontSize: 16 }}>Mark earlier episodes as seen?</div>
            <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: "2px 0 14px" }}>
              You still have {unseenPriors(pending)} unwatched {unseenPriors(pending) === 1 ? "episode" : "episodes"} up to
              {" "}S{pending.season_number} · E{pending.episode_number}. Mark them all as seen?
            </p>
            <div className="flex items-center gap-2.5">
              <button className="btn btn-accent flex-1" onClick={() => confirmMarkUpTo(pending)}>
                <Check size={16} />Mark all {unseenPriors(pending) + 1}
              </button>
              <button
                className="btn btn-outline flex-1"
                onClick={() => { markWatched.mutate(pending.id); setPending(null); }}
              >
                Only this one
              </button>
            </div>
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
            Marked {toast.count} {toast.count === 1 ? "episode" : "episodes"} as seen
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { undoMarks.mutate(toast.ids); setToast(null); }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  );
}
