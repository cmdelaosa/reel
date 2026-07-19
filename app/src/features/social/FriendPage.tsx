import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  Activity, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Clock, Eye, Heart,
  LayoutGrid, Play, Plus, Scale, Star, Tv, User,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, TabMenu } from "@/ui";
import { useShowMore } from "@/ui/ShowMore";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { relativeTime } from "@/domain/time";
import {
  useFriendProfile, useFriendProgress, useFriendWatchHistory,
  type FriendFollow, type FriendProgress,
} from "@/lib/friendProfile";
import { useLibrary, useFollow } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { tasteAffinity } from "@/lib/taste";
import { timeSpentLabel } from "@/lib/stats";
import { WatchHeatmap } from "@/features/you/WatchHeatmap";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import type { TitleRow } from "@/lib/schemas";

/* Friend profile page (route /friend/:id). rpc_friend_snapshot supplies the
   profile, episode counts and "watching now" (recent-first, ≤2 months since
   their last watch); useFriendProfile adds their full follow list + ratings,
   useFriendProgress their per-show watched/aired counts and
   useFriendWatchHistory their latest episode watches. A slim sticky header
   fuses identity + section tabs (Overview / Shows / Activity / Compare) and
   stays pinned under the top bar. Opening a show stacks the detail sheet on
   top via the shell's global ?title= param. */

const snapshotSchema = z.object({
  profile: z.object({
    id: z.string().uuid(),
    handle: z.string(),
    display_name: z.string(),
    avatar_url: z.string().nullable(),
    bio: z.string().nullable(),
    country: z.string().nullable(),
  }),
  stats: z.object({ shows: z.number(), episodes: z.number(), rated: z.number() }),
  watching: z.array(z.object({
    tmdb_id: z.number(),
    name: z.string(),
    poster_path: z.string().nullable(),
    network: z.string().nullable(),
    season_number: z.number(),
    episode_number: z.number(),
    // Post-0038 fields; optional so the page keeps parsing against the old RPC.
    watched: z.number().optional(),
    aired: z.number().optional(),
    last_watched_at: z.string().nullable().optional(),
  })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

type SectionKey = "overview" | "shows" | "activity" | "compare";
type ShowFilter = "all" | "both" | "not";
type ShowSort = "their" | "critic" | "air";
type SortDir = "desc" | "asc";

type Act = {
  kind: "rated" | "added" | "watched";
  at: string;
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  score?: number;
  count?: number;
  season_number?: number;
  episode_number?: number;
};

function MiniArt({ poster, name, className = "mq-row-art", style }: { poster: string | null; name: string; className?: string; style?: React.CSSProperties }) {
  const art = tmdbImg(poster, "w92");
  return (
    <div className={className} style={{ ...(art ? {} : { background: posterBg(name) }), ...style }}>
      {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      <div className="poster-sheen" />
    </div>
  );
}

function toTitleRow(f: FriendFollow): TitleRow {
  return {
    id: f.id, tmdb_id: f.tmdb_id, kind: "tv", name: f.name, overview: null,
    poster_path: f.poster_path, backdrop_path: null, first_air_date: f.first_air_date,
    status: f.status, genres: f.genres, network: f.network, episode_run_time: f.episode_run_time,
    vote_average: f.vote_average, popularity: null,
  };
}

function agreementLabel(theirs: number, mine: number): string {
  const d = Math.abs(theirs - mine);
  if (d === 0) return tr("Same score");
  if (d <= 1) return tr("You basically agree");
  if (d >= 4) return tr("You strongly disagree");
  return tr("Slightly different takes");
}

/** TV-Time-style progress: thin bar + "watched / aired" underneath a poster. */
function ProgressStrip({ watched, aired }: { watched: number; aired: number }) {
  const pct = aired > 0 ? Math.min(100, Math.round((watched / aired) * 100)) : 0;
  return (
    <div className="fr-progress">
      <div className="fr-matchbar" style={{ height: 5 }}><i style={{ width: `${pct}%` }} /></div>
      <span className="mute" style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>{watched}/{aired}</span>
    </div>
  );
}

/* Poster tile in the browsable "Shows" grid: their score (if rated), a
   common-ring when you follow it too, a one-tap Add, and their episode
   progress underneath. */
function FollowTile({ f, name, theirScore, progress, added, onOpen, onAdd }: {
  f: FriendFollow; name: string; theirScore?: number; progress?: FriendProgress; added: boolean; onOpen: () => void; onAdd: () => void;
}) {
  const art = tmdbImg(f.poster_path, "w342");
  return (
    <div className="fr-show">
      <div className={`fr-mini ${added ? "fr-common" : ""}`} style={{ background: posterBg(name) }} title={name} onClick={onOpen}>
        {art && <img src={art} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {theirScore != null && (
          <span className="badge badge-glass absolute" style={{ top: 6, left: 6, zIndex: 2, fontSize: 11, padding: "2px 6px" }}>
            <Star size={10} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} /> {theirScore}
          </span>
        )}
        <button
          className="btn btn-icon badge-glass absolute"
          style={{ top: 6, right: 6, zIndex: 2, color: "#fff", width: 26, height: 26 }}
          title={added ? tr("In your library") : tr("Add to your library")}
          aria-label={tv(added ? "{name} is in your library" : "Add {name} to your library", { name })}
          onClick={(e) => { e.stopPropagation(); if (!added) onAdd(); }}
        >
          {added ? <Check size={14} /> : <Plus size={14} />}
        </button>
        <span className="fr-mini-name">{name}</span>
      </div>
      {progress && progress.aired > 0 && <ProgressStrip watched={progress.watched} aired={progress.aired} />}
    </div>
  );
}

export default function FriendPage() {
  const { id = "" } = useParams();
  const friendId = id;
  const [, setSearchParams] = useSearchParams();

  const { data: snap, isPending } = useQuery({
    queryKey: ["friendSnapshot", friendId],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<Snapshot | null> => {
      const { data, error } = await supabase.rpc("rpc_friend_snapshot", { p_friend: friendId });
      if (error) throw error;
      return data ? snapshotSchema.parse(data) : null;
    },
  });

  const { data: fp } = useFriendProfile(friendId);
  const { data: progressMap } = useFriendProgress(friendId);
  const { data: watchHistory = [] } = useFriendWatchHistory(friendId);
  const { data: library = [] } = useLibrary();
  const { data: myRatings = [] } = useMyRatings();
  const follow = useFollow();

  const [section, setSection] = useState<SectionKey>("overview");
  const esNames = useEsNames();
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [showSort, setShowSort] = useState<ShowSort>("their");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const openTitle = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const myFollowIds = useMemo(() => new Set(library.map((r) => r.tmdb_id)), [library]);
  const myGenres = useMemo(() => new Set(library.flatMap((r) => r.genres)), [library]);
  const myScoreByTmdb = useMemo(() => new Map(myRatings.map((r) => [r.titles.tmdb_id, r.score])), [myRatings]);
  const theirScoreByTmdb = useMemo(() => new Map((fp?.ratings ?? []).map((r) => [r.tmdb_id, r.score])), [fp]);

  // Everything derived from the friend's follows + ratings.
  const derived = useMemo(() => {
    if (!fp) return null;
    const { follows, ratings } = fp;

    const sharedFollows = follows.filter((f) => myFollowIds.has(f.tmdb_id));
    // Same confidence-adjusted taste affinity as the /friends/taste leaderboard,
    // so a friend shows one number app-wide (replaces the old follow-overlap %).
    const affinity = tasteAffinity(myScoreByTmdb, theirScoreByTmdb);

    const coRated = ratings
      .filter((r) => myScoreByTmdb.has(r.tmdb_id))
      .map((r) => ({ ...r, mine: myScoreByTmdb.get(r.tmdb_id)! }))
      .sort((a, b) => Math.abs(b.score - b.mine) - Math.abs(a.score - a.mine));

    const genreCounts = new Map<string, number>();
    for (const f of follows) for (const g of f.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    const sharedGenres = topGenres.filter((g) => myGenres.has(g.name)).slice(0, 8).map((g) => g.name);

    const netCounts = new Map<string, number>();
    for (const f of follows) if (f.network) netCounts.set(f.network, (netCounts.get(f.network) ?? 0) + 1);
    const topNetworks = [...netCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

    const runtimes = follows.map((f) => f.episode_run_time).filter((n): n is number => n != null && n > 0);
    const avgRuntime = runtimes.length ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length : 42;
    const avgRating = ratings.length ? ratings.reduce((a, b) => a + b.score, 0) / ratings.length : null;

    return { sharedFollows, affinity, coRated, topGenres, sharedGenres, topNetworks, avgRuntime, avgRating };
  }, [fp, myFollowIds, myGenres, myScoreByTmdb, theirScoreByTmdb]);

  // Activity feed: episode watches (consecutive same-show-same-day runs are
  // collapsed into one "watched N episodes" entry) + ratings + follows.
  const activity = useMemo(() => {
    if (!fp) return [];
    const watched: Act[] = [];
    for (const w of watchHistory) {
      const last = watched[watched.length - 1];
      if (last && last.tmdb_id === w.tmdb_id && last.at.slice(0, 10) === w.watched_at.slice(0, 10)) {
        last.count = (last.count ?? 1) + 1;
      } else {
        watched.push({
          kind: "watched", at: w.watched_at, tmdb_id: w.tmdb_id, name: w.name,
          poster_path: w.poster_path, count: 1,
          season_number: w.season_number, episode_number: w.episode_number,
        });
      }
    }
    const rest: Act[] = [
      ...fp.ratings.map((r): Act => ({ kind: "rated", at: r.created_at, tmdb_id: r.tmdb_id, name: r.name, poster_path: r.poster_path, score: r.score })),
      ...fp.follows.map((f): Act => ({ kind: "added", at: f.added_at, tmdb_id: f.tmdb_id, name: f.name, poster_path: f.poster_path })),
    ];
    return [...watched, ...rest].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 24);
  }, [fp, watchHistory]);

  // Browsable follows: follow-overlap filter + sort, either way up.
  const browseFollows = useMemo(() => {
    let list = fp?.follows ?? [];
    if (showFilter === "both") list = list.filter((f) => myFollowIds.has(f.tmdb_id));
    if (showFilter === "not") list = list.filter((f) => !myFollowIds.has(f.tmdb_id));
    // One numeric key per field so the direction is a single sign flip; dates
    // become timestamps rather than a second, string-shaped comparison.
    const rank: Record<ShowSort, (f: FriendFollow) => number | null> = {
      their: (f) => theirScoreByTmdb.get(f.tmdb_id) ?? null,
      critic: (f) => f.vote_average ?? null,
      air: (f) => {
        const t = f.first_air_date ? Date.parse(f.first_air_date) : NaN;
        return Number.isNaN(t) ? null : t;
      },
    };
    const key = rank[showSort];
    const dir = sortDir === "asc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const ka = key(a), kb = key(b);
      // Shows with no value sink whichever way the sort runs. Flipping to
      // "lowest first" is a request for their worst scores, not for the pile
      // they never scored at all — those would otherwise take the whole screen.
      if (ka == null || kb == null) {
        if (ka != null) return -1;
        if (kb != null) return 1;
      } else if (ka !== kb) {
        return dir * (kb - ka);
      }
      return a.name.localeCompare(b.name);
    });
  }, [fp, showFilter, showSort, sortDir, myFollowIds, theirScoreByTmdb]);

  // 9 at a time, so the comparison grid reveals whole rows at its widest (three
  // 320px columns). Must sit above the early returns — it is a hook.
  const { shown: coRatedShown, more: coRatedMore } = useShowMore(derived?.coRated ?? [], 9);

  const hue = hueOf(friendId);
  const estMinutes = snap && derived ? Math.round(snap.stats.episodes * derived.avgRuntime) : 0;

  if (isPending) {
    return <div className="screen mq-page"><div className="dim">{tr("Loading…")}</div></div>;
  }
  if (!snap) {
    return (
      <div className="screen mq-page">
        <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontWeight: 750, fontSize: 16 }}>{tr("Profile not available")}</div>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
            {tr("This profile is private or not one of your friends.")}
          </p>
        </div>
      </div>
    );
  }

  // The last tab holds nothing but the head-to-head, so it is named and drawn
  // for that: a balance, not the star it shared with every other rating in the
  // app. "Notas" said whose notes it was showing, and the answer was "both".
  const sections: { v: SectionKey; label: string; icon: typeof User }[] = [
    { v: "overview", label: tr("Overview"), icon: User },
    { v: "shows", label: tr("Shows"), icon: LayoutGrid },
    { v: "activity", label: tr("Activity"), icon: Activity },
    { v: "compare", label: tr("Compare"), icon: Scale },
  ];

  const filters: { v: ShowFilter; label: string }[] = [
    { v: "all", label: tr("All") },
    { v: "both", label: tr("You both follow") },
    { v: "not", label: tr("You don't follow") },
  ];

  const sorts: { v: ShowSort; label: string }[] = [
    { v: "their", label: tr("Their rating") },
    { v: "critic", label: tr("Critic rating") },
    { v: "air", label: tr("Air date") },
  ];
  // What the arrow means depends on the field it points at — "lowest first" on
  // an air date is nonsense, and the toggle is the only thing naming the order.
  const dirLabel = showSort === "air"
    ? sortDir === "desc"
      ? tr("Newest first")
      : tr("Oldest first")
    : sortDir === "desc"
      ? tr("Highest first")
      : tr("Lowest first");

  const watchingCards = snap.watching.map((w) => {
    const wName = locName(esNames, w.tmdb_id, w.name);
    const p = w.watched != null && w.aired != null
      ? { watched: w.watched, aired: w.aired }
      : progressMap?.get(w.tmdb_id);
    const pct = p && p.aired > 0 ? Math.min(100, Math.round((p.watched / p.aired) * 100)) : null;
    return (
      <div key={w.tmdb_id} className="card mq-row" onClick={() => openTitle(w.tmdb_id)}>
        <MiniArt poster={w.poster_path} name={wName} style={{ width: 52, height: 76 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{wName}</div>
          <div className="dim" style={{ fontSize: 12.5 }}>
            {tr("On")} S{w.season_number} · E{w.episode_number}
            {w.last_watched_at ? <span className="mute"> · {tr("activity: watched")} {relativeTime(w.last_watched_at, new Date(), dateLocale())}</span> : null}
          </div>
          {pct != null && (
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <div className="fr-matchbar" style={{ flex: 1, height: 5 }}><i style={{ width: `${pct}%` }} /></div>
              <span className="mute" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{p!.watched}/{p!.aired}</span>
            </div>
          )}
        </div>
        {w.network && <NetworkLogo network={w.network} size={11} />}
      </div>
    );
  });

  return (
    <div className="screen mq-page">
      {/* Slim sticky header: identity + section tabs over a fading hue wash */}
      <div className="fr-hero" style={{ "--fr-hue": hue } as React.CSSProperties}>
        <div className="fr-hero-id">
          <FriendAvatar f={{ id: snap.profile.id, name: snap.profile.display_name, avatarUrl: snap.profile.avatar_url }} size={44} ring />
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 16, fontWeight: 800 }}>{snap.profile.display_name}</div>
            <div className="dim truncate" style={{ fontSize: 12 }}>@{snap.profile.handle}{snap.profile.country ? ` · ${snap.profile.country}` : ""}</div>
          </div>
        </div>
        {/* Buttons, not divs: on a phone CSS drops the label of every tab but
            the active one to keep all four on one line, and only an aria-label
            on a focusable control survives that. */}
        <div className="segmented scroll no-scrollbar fr-hero-tabs">
          {sections.map((s) => (
            <button
              key={s.v}
              type="button"
              className={`seg ${section === s.v ? "seg-active" : ""}`}
              onClick={() => setSection(s.v)}
              aria-label={s.label}
              title={s.label}
            >
              <s.icon size={14} /><span className="seg-label">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {section === "overview" && (
          <>
            {/* Watching now — the first thing you see */}
            {snap.watching.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="eyebrow flex items-center gap-1.5"><Play size={13} />{tr("Watching now")}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                  {watchingCards}
                </div>
              </section>
            )}

            {/* Stats */}
            <div className="fr-stats">
              {[
                { icon: Tv, label: tr("Shows"), value: snap.stats.shows },
                { icon: Eye, label: tr("Episodes"), value: snap.stats.episodes.toLocaleString() },
                { icon: Star, label: tr("Rated"), value: snap.stats.rated },
                { icon: Clock, label: tr("Est. watch time"), value: derived ? `~${timeSpentLabel(estMinutes)}` : "—" },
                { icon: Heart, label: tr("Avg. rating"), value: derived?.avgRating != null ? derived.avgRating.toFixed(1) : "—" },
              ].map((st) => (
                <div key={st.label} className="card p-3 flex flex-col gap-0.5">
                  <st.icon size={16} style={{ color: "var(--accent)" }} />
                  <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{st.value}</div>
                  <div className="mute" style={{ fontSize: 11.5 }}>{st.label}</div>
                </div>
              ))}
            </div>

            {/* Taste match — the same confidence-adjusted figure as /friends/taste */}
            {derived && (
              <div className="card p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700 }}>
                    <Heart size={15} style={{ color: "var(--accent)" }} />
                    {derived.affinity
                      ? tv("{pct}% taste match", { pct: derived.affinity.pct })
                      : tr("No taste match yet")}
                  </div>
                  <span className="mute" style={{ fontSize: 12.5 }}>
                    {derived.affinity ? `${derived.affinity.common} ${tr("rated in common")} · ` : ""}
                    {derived.sharedFollows.length} {tr("shows in common")}
                  </span>
                </div>
                <div className="fr-matchbar"><i style={{ width: `${derived.affinity?.pct ?? 0}%` }} /></div>
                {!derived.affinity && (
                  <p className="mute" style={{ fontSize: 12, margin: 0 }}>
                    {tr("Rate shows you've both seen and the match score appears.")}
                  </p>
                )}
                {derived.sharedGenres.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 2 }}>
                    <span className="mute" style={{ fontSize: 11.5 }}>{tr("Shared taste:")}</span>
                    {derived.sharedGenres.map((g) => <span key={g} className="badge badge-soft" style={{ fontSize: 11 }}>{tGenre(g)}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* Taste profile + their watch activity, side by side on web */}
            <section className="taste-grid">
              {derived && derived.topGenres.length > 0 && (
                <div className="taste-col">
                  <div className="eyebrow">{tr("Taste profile")}</div>
                  <div className="card p-4 flex flex-col gap-2">
                    {derived.topGenres.slice(0, 8).map((g) => (
                      <div key={g.name} className="flex items-center gap-2.5">
                        <span className="truncate" style={{ width: 150, fontSize: 12.5, flex: "0 0 auto" }}>{tGenre(g.name)}</span>
                        <div className="fr-matchbar" style={{ flex: 1 }}><i style={{ width: `${(g.count / derived.topGenres[0].count) * 100}%` }} /></div>
                        <span className="mute" style={{ fontSize: 11.5, width: 24, textAlign: "right", flex: "0 0 auto" }}>{g.count}</span>
                      </div>
                    ))}
                  </div>
                  {derived.topNetworks.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {derived.topNetworks.map((n) => (
                        <span key={n.name} className="badge badge-soft" style={{ fontSize: 11 }}>{n.name} · {n.count}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <WatchHeatmap userId={friendId} />
            </section>
          </>
        )}

        {section === "shows" && (
          <section className="flex flex-col gap-3">
            <div className="fr-toolbar">
              <div className="segmented scroll no-scrollbar">
                {filters.map((f) => (
                  <button
                    key={f.v}
                    type="button"
                    className={`seg ${showFilter === f.v ? "seg-active" : ""}`}
                    onClick={() => setShowFilter(f.v)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {/* Phone shape of the same three — "You don't follow" alone is
                  half a 375px row, so the strip wrapped onto a second line. */}
              <TabMenu
                value={showFilter}
                options={filters.map((f) => ({ key: f.v, label: f.label }))}
                onPick={setShowFilter}
                menuLabel={tr("Filter shows")}
              />
              <div className="fr-sort">
                <TabMenu
                  value={showSort}
                  options={sorts.map((s) => ({ key: s.v, label: s.label }))}
                  onPick={setShowSort}
                  menuLabel={tr("Sort")}
                  align="end"
                  always
                />
                <button
                  type="button"
                  className="chip chip-icon"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  aria-label={dirLabel}
                  title={dirLabel}
                >
                  {sortDir === "desc" ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
                </button>
              </div>
            </div>
            {browseFollows.length === 0 ? (
              <p className="dim" style={{ fontSize: 13, margin: 0 }}>{tr("Nothing here.")}</p>
            ) : (
              <>
                <div className="eyebrow">{browseFollows.length} {tr("shows")}</div>
                <div className="fr-grid">
                  {browseFollows.map((f) => (
                    <FollowTile
                      key={f.tmdb_id}
                      f={f}
                      name={locName(esNames, f.tmdb_id, f.name)}
                      theirScore={theirScoreByTmdb.get(f.tmdb_id)}
                      progress={progressMap?.get(f.tmdb_id)}
                      added={myFollowIds.has(f.tmdb_id)}
                      onOpen={() => openTitle(f.tmdb_id)}
                      onAdd={() => follow.mutate(toTitleRow(f))}
                    />
                  ))}
                </div>
                <span className="mute" style={{ fontSize: 11.5 }}>
                  {/* One key for the whole legend: the + icon is slotted back
                      where the translation puts {plus}, not where English did. */}
                  {tr("Ring = you follow it too · {plus} adds to your library · bar = their progress.")
                    .split("{plus}")
                    .flatMap((part, i) => (i === 0 ? [part] : [<Plus key={i} size={11} style={{ verticalAlign: "-1px" }} />, part]))}
                </span>
              </>
            )}
          </section>
        )}

        {section === "activity" && (
          <section className="flex flex-col gap-1.5">
            <div className="eyebrow flex items-center gap-1.5"><Activity size={13} />{tr("Recent activity")}</div>
            {activity.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr("No activity yet.")}</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 6 }}>
                {activity.map((a, i) => (
                  <div key={`${a.kind}-${a.tmdb_id}-${i}`} className="fr-activity" onClick={() => openTitle(a.tmdb_id)} style={{ cursor: "pointer" }}>
                    <span className="badge badge-soft btn-icon" style={{ width: 30, height: 30, flex: "0 0 auto" }}>
                      {a.kind === "rated" ? <Star size={14} style={{ color: "var(--accent)" }} />
                        : a.kind === "watched" ? <Eye size={14} style={{ color: "var(--accent)" }} />
                        : <Plus size={14} />}
                    </span>
                    <div className="min-w-0 flex-1" style={{ fontSize: 13.5 }}>
                      {a.kind === "watched" ? (
                        <>
                          <span className="mute">{tr("activity: Watched")}{" "}</span>
                          {(a.count ?? 1) > 1
                            ? <><b style={{ fontWeight: 700 }}>{a.count} {tr("episodes")}</b><span className="mute"> {tr("of")} </span></>
                            : <><b style={{ fontWeight: 700 }}>S{a.season_number} · E{a.episode_number}</b><span className="mute"> {tr("of")} </span></>}
                          <b style={{ fontWeight: 700 }}>{locName(esNames, a.tmdb_id, a.name)}</b>
                        </>
                      ) : (
                        <>
                          <span className="mute">{a.kind === "rated" ? tr("activity: Rated") : tr("activity: Added")}{" "}</span>
                          <b style={{ fontWeight: 700 }}>{locName(esNames, a.tmdb_id, a.name)}</b>
                          {a.kind === "rated" && a.score != null && <span className="mute"> · {a.score}/10</span>}
                        </>
                      )}
                    </div>
                    <span className="mute" style={{ fontSize: 12, flex: "0 0 auto" }}>{relativeTime(a.at, new Date(), dateLocale())}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Head-to-head only. "Their top ratings" sat above it saying nothing
            about the two of you, and it was already the first thing the Activity
            feed and the Overview's average covered. Everything you have both
            rated is reachable now, 9 at a press: the list runs widest
            disagreement first, so the old hard cap of 8 always cut from the
            agreeing end — the half of the picture that says you two match. */}
        {section === "compare" && (
          <>
            {derived && derived.coRated.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <div className="eyebrow flex items-center gap-1.5">
                  <Scale size={13} />{tr("You both rated")} · {derived.coRated.length}
                </div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {coRatedShown.map((c) => (
                    <div key={c.tmdb_id} className="card mq-row" onClick={() => openTitle(c.tmdb_id)}>
                      <MiniArt poster={c.poster_path} name={locName(esNames, c.tmdb_id, c.name)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{locName(esNames, c.tmdb_id, c.name)}</div>
                        <div className="dim" style={{ fontSize: 12.5 }}>{agreementLabel(c.score, c.mine)}</div>
                      </div>
                      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
                        <span className="badge badge-soft" title={tr("Their score")} style={{ fontWeight: 800 }}>{tr("Them")} {c.score}</span>
                        <span className="badge badge-soft" title={tr("Your score")} style={{ fontWeight: 800 }}>{tr("You")} {c.mine}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {coRatedMore}
              </div>
            )}
            {derived && derived.coRated.length === 0 && (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>
                  {tr("You haven't both rated the same show yet. Rate one you've both seen and it shows up here.")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
