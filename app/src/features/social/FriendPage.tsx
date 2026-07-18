import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { Activity, Check, Clock, Eye, Heart, LayoutGrid, Play, Plus, Star, Tv, User } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, Stars } from "@/ui";
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
import { dateLocale, isEs, locName, t as tr, tGenre, useEsNames } from "@/lib/i18n";
import type { TitleRow } from "@/lib/schemas";

/* Friend profile page (route /friend/:id). rpc_friend_snapshot supplies the
   profile, episode counts and "watching now" (recent-first, ≤2 months since
   their last watch); useFriendProfile adds their full follow list + ratings,
   useFriendProgress their per-show watched/aired counts and
   useFriendWatchHistory their latest episode watches. A slim sticky header
   fuses identity + section tabs (Overview / Shows / Activity / Ratings) and
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

type SectionKey = "overview" | "shows" | "activity" | "ratings";
type ShowFilter = "all" | "both" | "not";
type ShowSort = "their" | "critic" | "air";

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
  if (isEs()) {
    if (d === 0) return "Misma nota";
    if (d <= 1) return "Básicamente coincidís";
    if (d >= 4) return "Discrepáis totalmente";
    return "Opiniones algo distintas";
  }
  if (d === 0) return "Same score";
  if (d <= 1) return "You basically agree";
  if (d >= 4) return "You strongly disagree";
  return "Slightly different takes";
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
          title={added ? (isEs() ? "En tu biblioteca" : "In your library") : (isEs() ? "Añadir a tu biblioteca" : "Add to your library")}
          aria-label={added ? `${name} is in your library` : `Add ${name} to your library`}
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

    const topRated = [...ratings].sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at)).slice(0, 8);

    return { sharedFollows, affinity, coRated, topGenres, sharedGenres, topNetworks, avgRuntime, avgRating, topRated };
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

  // Browsable follows: follow-overlap filter + sort.
  const browseFollows = useMemo(() => {
    let list = fp?.follows ?? [];
    if (showFilter === "both") list = list.filter((f) => myFollowIds.has(f.tmdb_id));
    if (showFilter === "not") list = list.filter((f) => !myFollowIds.has(f.tmdb_id));
    const by: Record<ShowSort, (a: FriendFollow, b: FriendFollow) => number> = {
      their: (a, b) => (theirScoreByTmdb.get(b.tmdb_id) ?? -1) - (theirScoreByTmdb.get(a.tmdb_id) ?? -1) || a.name.localeCompare(b.name),
      critic: (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || a.name.localeCompare(b.name),
      air: (a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? "") || a.name.localeCompare(b.name),
    };
    return [...list].sort(by[showSort]);
  }, [fp, showFilter, showSort, myFollowIds, theirScoreByTmdb]);

  const hue = hueOf(friendId);
  const estMinutes = snap && derived ? Math.round(snap.stats.episodes * derived.avgRuntime) : 0;

  if (isPending) {
    return <div className="screen mq-page"><div className="dim">{tr("Loading…")}</div></div>;
  }
  if (!snap) {
    return (
      <div className="screen mq-page">
        <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontWeight: 750, fontSize: 16 }}>{isEs() ? "Perfil no disponible" : "Profile not available"}</div>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
            {isEs() ? "Este perfil es privado o no es de uno de tus amigos." : "This profile is private or not one of your friends."}
          </p>
        </div>
      </div>
    );
  }

  const sections: { v: SectionKey; label: string; icon: typeof User }[] = isEs()
    ? [
        { v: "overview", label: "Resumen", icon: User },
        { v: "shows", label: "Series", icon: LayoutGrid },
        { v: "activity", label: "Actividad", icon: Activity },
        { v: "ratings", label: "Notas", icon: Star },
      ]
    : [
        { v: "overview", label: "Overview", icon: User },
        { v: "shows", label: "Shows", icon: LayoutGrid },
        { v: "activity", label: "Activity", icon: Activity },
        { v: "ratings", label: "Ratings", icon: Star },
      ];

  const filters: { v: ShowFilter; label: string }[] = isEs()
    ? [
        { v: "all", label: "Todas" },
        { v: "both", label: "Seguís los dos" },
        { v: "not", label: "No la sigues" },
      ]
    : [
        { v: "all", label: "All" },
        { v: "both", label: "You both follow" },
        { v: "not", label: "You don't follow" },
      ];

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
            {isEs() ? "Por" : "On"} S{w.season_number} · E{w.episode_number}
            {w.last_watched_at ? <span className="mute"> · {isEs() ? "visto" : "watched"} {relativeTime(w.last_watched_at, new Date(), dateLocale())}</span> : null}
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
        <div className="segmented scroll fr-hero-tabs">
          {sections.map((s) => (
            <div key={s.v} className={`seg ${section === s.v ? "seg-active" : ""}`} onClick={() => setSection(s.v)}>
              <s.icon size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />{s.label}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {section === "overview" && (
          <>
            {/* Watching now — the first thing you see */}
            {snap.watching.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="eyebrow flex items-center gap-1.5"><Play size={13} />{isEs() ? "Viendo ahora" : "Watching now"}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                  {watchingCards}
                </div>
              </section>
            )}

            {/* Stats */}
            <div className="fr-stats">
              {[
                { icon: Tv, label: isEs() ? "Series" : "Shows", value: snap.stats.shows },
                { icon: Eye, label: isEs() ? "Episodios" : "Episodes", value: snap.stats.episodes.toLocaleString() },
                { icon: Star, label: isEs() ? "Puntuadas" : "Rated", value: snap.stats.rated },
                { icon: Clock, label: isEs() ? "Tiempo estimado" : "Est. watch time", value: derived ? `~${timeSpentLabel(estMinutes)}` : "—" },
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
                      ? `${derived.affinity.pct}% ${isEs() ? "de afinidad" : "taste match"}`
                      : isEs() ? "Aún sin afinidad" : "No taste match yet"}
                  </div>
                  <span className="mute" style={{ fontSize: 12.5 }}>
                    {derived.affinity ? `${derived.affinity.common} ${tr("rated in common")} · ` : ""}
                    {derived.sharedFollows.length} {isEs() ? "series en común" : "shows in common"}
                  </span>
                </div>
                <div className="fr-matchbar"><i style={{ width: `${derived.affinity?.pct ?? 0}%` }} /></div>
                {!derived.affinity && (
                  <p className="mute" style={{ fontSize: 12, margin: 0 }}>
                    {isEs() ? "Puntuad series que hayáis visto los dos y aparecerá la afinidad." : "Rate shows you've both seen and the match score appears."}
                  </p>
                )}
                {derived.sharedGenres.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 2 }}>
                    <span className="mute" style={{ fontSize: 11.5 }}>{isEs() ? "Gustos compartidos:" : "Shared taste:"}</span>
                    {derived.sharedGenres.map((g) => <span key={g} className="badge badge-soft" style={{ fontSize: 11 }}>{tGenre(g)}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* Taste profile, then their watch activity — each full width */}
            <>
              {derived && derived.topGenres.length > 0 && (
                <section className="flex flex-col gap-3">
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
                </section>
              )}
              <WatchHeatmap userId={friendId} />
            </>
          </>
        )}

        {section === "shows" && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="segmented scroll">
                {filters.map((f) => (
                  <div key={f.v} className={`seg ${showFilter === f.v ? "seg-active" : ""}`} onClick={() => setShowFilter(f.v)}>
                    {f.label}
                  </div>
                ))}
              </div>
              <select className="year-select" value={showSort} onChange={(e) => setShowSort(e.target.value as ShowSort)} aria-label="Sort">
                <option value="their">{isEs() ? "Su nota" : "Their rating"}</option>
                <option value="critic">{isEs() ? "Nota TMDB" : "Critic rating"}</option>
                <option value="air">{isEs() ? "Fecha de emisión" : "Air date"}</option>
              </select>
            </div>
            {browseFollows.length === 0 ? (
              <p className="dim" style={{ fontSize: 13, margin: 0 }}>{isEs() ? "Nada por aquí." : "Nothing here."}</p>
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
                  {isEs()
                    ? <>Anillo = tú también la sigues · <Plus size={11} style={{ verticalAlign: "-1px" }} /> la añade a tu biblioteca · barra = su progreso.</>
                    : <>Ring = you follow it too · <Plus size={11} style={{ verticalAlign: "-1px" }} /> adds to your library · bar = their progress.</>}
                </span>
              </>
            )}
          </section>
        )}

        {section === "activity" && (
          <section className="flex flex-col gap-1.5">
            <div className="eyebrow flex items-center gap-1.5"><Activity size={13} />{isEs() ? "Actividad reciente" : "Recent activity"}</div>
            {activity.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>{isEs() ? "Aún sin actividad." : "No activity yet."}</p>
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
                          <span className="mute">{isEs() ? "Vio " : "Watched "}</span>
                          {(a.count ?? 1) > 1
                            ? <><b style={{ fontWeight: 700 }}>{a.count} {tr("episodes")}</b><span className="mute"> {isEs() ? "de" : "of"} </span></>
                            : <><b style={{ fontWeight: 700 }}>S{a.season_number} · E{a.episode_number}</b><span className="mute"> {isEs() ? "de" : "of"} </span></>}
                          <b style={{ fontWeight: 700 }}>{locName(esNames, a.tmdb_id, a.name)}</b>
                        </>
                      ) : (
                        <>
                          <span className="mute">{a.kind === "rated" ? (isEs() ? "Puntuó" : "Rated") : (isEs() ? "Añadió" : "Added")} </span>
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

        {section === "ratings" && (
          <>
            {derived && derived.topRated.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="eyebrow">{isEs() ? "Sus mejores notas" : "Their top ratings"}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {derived.topRated.map((r) => (
                    <div key={r.tmdb_id} className="card mq-row" onClick={() => openTitle(r.tmdb_id)}>
                      <MiniArt poster={r.poster_path} name={locName(esNames, r.tmdb_id, r.name)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{locName(esNames, r.tmdb_id, r.name)}</div>
                        <Stars score={r.score} size={12} />
                      </div>
                      <span className="badge badge-soft" style={{ fontWeight: 800 }}>{r.score}/10</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {derived && derived.coRated.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <div className="eyebrow">{isEs() ? "Puntuadas por los dos" : "You both rated"} · {derived.coRated.length}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {derived.coRated.slice(0, 8).map((c) => (
                    <div key={c.tmdb_id} className="card mq-row" onClick={() => openTitle(c.tmdb_id)}>
                      <MiniArt poster={c.poster_path} name={locName(esNames, c.tmdb_id, c.name)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{locName(esNames, c.tmdb_id, c.name)}</div>
                        <div className="dim" style={{ fontSize: 12.5 }}>{agreementLabel(c.score, c.mine)}</div>
                      </div>
                      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
                        <span className="badge badge-soft" title="Their score" style={{ fontWeight: 800 }}>{tr("Them")} {c.score}</span>
                        <span className="badge badge-soft" title="Your score" style={{ fontWeight: 800 }}>{tr("You")} {c.mine}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {derived && derived.topRated.length === 0 && derived.coRated.length === 0 && (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>{isEs() ? "Aún sin notas." : "No ratings yet."}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
