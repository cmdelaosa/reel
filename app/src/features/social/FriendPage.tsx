import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Activity, Check, ChevronLeft, Clock, Eye, Heart, LayoutGrid, Play, Plus, Star, Tv, User } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, Stars } from "@/ui";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { relativeTime } from "@/domain/time";
import { useFriendProfile, useFriendProgress, type FriendFollow, type FriendProgress } from "@/lib/friendProfile";
import { useLibrary, useFollow } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { timeSpentLabel } from "@/lib/stats";
import type { TitleRow } from "@/lib/schemas";

/* Friend profile page (route /friend/:id). rpc_friend_snapshot supplies the
   profile, episode counts and "watching now" (recent-first, ≤2 months since
   their last watch); useFriendProfile adds their full follow list + ratings and
   useFriendProgress their per-show watched/aired counts. The page is split into
   sections behind a sticky segmented bar (Overview / Watching / Shows /
   Activity / Ratings) instead of one long scroll. Opening a show stacks the
   detail sheet on top via the shell's global ?title= param. */

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

type SectionKey = "overview" | "watching" | "shows" | "activity" | "ratings";

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

/* Poster tile in the browsable "Everything they follow" grid: their score
   (if rated), a common-ring when you follow it too, a one-tap Add, and their
   episode progress underneath. */
function FollowTile({ f, theirScore, progress, added, onOpen, onAdd }: {
  f: FriendFollow; theirScore?: number; progress?: FriendProgress; added: boolean; onOpen: () => void; onAdd: () => void;
}) {
  const art = tmdbImg(f.poster_path, "w342");
  return (
    <div className="fr-show">
      <div className={`fr-mini ${added ? "fr-common" : ""}`} style={{ background: posterBg(f.name) }} title={f.name} onClick={onOpen}>
        {art && <img src={art} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {theirScore != null && (
          <span className="badge badge-glass absolute" style={{ top: 6, left: 6, zIndex: 2, fontSize: 11, padding: "2px 6px" }}>
            <Star size={10} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} /> {theirScore}
          </span>
        )}
        <button
          className="btn btn-icon badge-glass absolute"
          style={{ top: 6, right: 6, zIndex: 2, color: "#fff", width: 26, height: 26 }}
          title={added ? "In your library" : "Add to your library"}
          aria-label={added ? `${f.name} is in your library` : `Add ${f.name} to your library`}
          onClick={(e) => { e.stopPropagation(); if (!added) onAdd(); }}
        >
          {added ? <Check size={14} /> : <Plus size={14} />}
        </button>
        <span className="fr-mini-name">{f.name}</span>
      </div>
      {progress && progress.aired > 0 && <ProgressStrip watched={progress.watched} aired={progress.aired} />}
    </div>
  );
}

export default function FriendPage() {
  const { id = "" } = useParams();
  const friendId = id;
  const navigate = useNavigate();
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
  const { data: library = [] } = useLibrary();
  const { data: myRatings = [] } = useMyRatings();
  const follow = useFollow();

  const [section, setSection] = useState<SectionKey>("overview");
  const [genre, setGenre] = useState<string>("");
  const [sort, setSort] = useState<"name" | "year" | "rating">("name");

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
    const match = follows.length ? Math.round((sharedFollows.length / follows.length) * 100) : 0;

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

    type Act = { kind: "rated" | "added"; at: string; tmdb_id: number; name: string; poster_path: string | null; score?: number };
    const activity: Act[] = [
      ...ratings.map((r): Act => ({ kind: "rated", at: r.created_at, tmdb_id: r.tmdb_id, name: r.name, poster_path: r.poster_path, score: r.score })),
      ...follows.map((f): Act => ({ kind: "added", at: f.added_at, tmdb_id: f.tmdb_id, name: f.name, poster_path: f.poster_path })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 16);

    return { sharedFollows, match, coRated, topGenres, sharedGenres, topNetworks, avgRuntime, avgRating, topRated, activity };
  }, [fp, myFollowIds, myGenres, myScoreByTmdb]);

  // Browsable follows: genre filter + sort.
  const followGenres = useMemo(() => [...new Set((fp?.follows ?? []).flatMap((f) => f.genres))].sort(), [fp]);
  const browseFollows = useMemo(() => {
    let list = fp?.follows ?? [];
    if (genre) list = list.filter((f) => f.genres.includes(genre));
    const by = {
      name: (a: FriendFollow, b: FriendFollow) => a.name.localeCompare(b.name),
      year: (a: FriendFollow, b: FriendFollow) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""),
      rating: (a: FriendFollow, b: FriendFollow) => (theirScoreByTmdb.get(b.tmdb_id) ?? b.vote_average ?? 0) - (theirScoreByTmdb.get(a.tmdb_id) ?? a.vote_average ?? 0),
    }[sort];
    return [...list].sort(by);
  }, [fp, genre, sort, theirScoreByTmdb]);

  const hue = hueOf(friendId);
  const estMinutes = snap && derived ? Math.round(snap.stats.episodes * derived.avgRuntime) : 0;

  const back = (
    <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>
      <ChevronLeft size={15} />Back
    </button>
  );

  if (isPending) {
    return <div className="screen mq-page">{back}<div className="dim">Loading…</div></div>;
  }
  if (!snap) {
    return (
      <div className="screen mq-page">
        {back}
        <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontWeight: 750, fontSize: 16 }}>Profile not available</div>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>This profile is private or not one of your friends.</p>
        </div>
      </div>
    );
  }

  const sections: { v: SectionKey; label: string; icon: typeof User }[] = [
    { v: "overview", label: "Overview", icon: User },
    { v: "watching", label: "Watching", icon: Play },
    { v: "shows", label: "Shows", icon: LayoutGrid },
    { v: "activity", label: "Activity", icon: Activity },
    { v: "ratings", label: "Ratings", icon: Star },
  ];

  return (
    <div className="screen mq-page">
      {back}

      {/* Hero. The banner keeps to its own box (no absolute overlay) and the
          avatar row is lifted above it with position+z-index — a positioned
          banner otherwise paints over the statically-positioned avatar. */}
      <div className="card overflow-hidden">
        <div style={{ height: 96, background: `linear-gradient(120deg, hsl(${hue} 60% 42%), hsl(${(hue + 50) % 360} 65% 24%))`, opacity: 0.9 }} />
        <div className="px-6 pb-5" style={{ marginTop: -36 }}>
          <div className="flex items-end gap-4 flex-wrap relative" style={{ zIndex: 1 }}>
            <FriendAvatar f={{ id: snap.profile.id, name: snap.profile.display_name, avatarUrl: snap.profile.avatar_url }} size={88} ring />
            <div className="pb-1 min-w-0">
              <div style={{ fontSize: 24, fontWeight: 800 }}>{snap.profile.display_name}</div>
              <div className="dim" style={{ fontSize: 13.5 }}>@{snap.profile.handle}{snap.profile.country ? ` · ${snap.profile.country}` : ""}</div>
            </div>
          </div>
          {snap.profile.bio && <p className="dim" style={{ fontSize: 14, margin: "12px 0 0", maxWidth: "62ch" }}>{snap.profile.bio}</p>}
        </div>
      </div>

      {/* Section switcher — sticky, like the calendar's view bar */}
      <div className="fr-tabsbar">
        <div className="segmented" style={{ flexWrap: "wrap" }}>
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
            {/* Stats */}
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {[
                { icon: Tv, label: "Shows", value: snap.stats.shows },
                { icon: Eye, label: "Episodes", value: snap.stats.episodes.toLocaleString() },
                { icon: Star, label: "Rated", value: snap.stats.rated },
                { icon: Clock, label: "Est. watch time", value: derived ? `~${timeSpentLabel(estMinutes)}` : "—" },
                { icon: Heart, label: "Avg. rating", value: derived?.avgRating != null ? derived.avgRating.toFixed(1) : "—" },
              ].map((st) => (
                <div key={st.label} className="card p-3 flex flex-col gap-0.5">
                  <st.icon size={16} style={{ color: "var(--accent)" }} />
                  <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{st.value}</div>
                  <div className="mute" style={{ fontSize: 11.5 }}>{st.label}</div>
                </div>
              ))}
            </div>

            {/* Match */}
            {derived && (
              <div className="card p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700 }}>
                    <Heart size={15} style={{ color: "var(--accent)" }} />{derived.match}% match with you
                  </div>
                  <span className="mute" style={{ fontSize: 12.5 }}>{derived.sharedFollows.length} shows in common</span>
                </div>
                <div className="fr-matchbar"><i style={{ width: `${derived.match}%` }} /></div>
                {derived.sharedGenres.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 2 }}>
                    <span className="mute" style={{ fontSize: 11.5 }}>Shared taste:</span>
                    {derived.sharedGenres.map((g) => <span key={g} className="badge badge-soft" style={{ fontSize: 11 }}>{g}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* Taste profile */}
            {derived && derived.topGenres.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="eyebrow">Taste profile</div>
                <div className="card p-4 flex flex-col gap-2">
                  {derived.topGenres.slice(0, 8).map((g) => (
                    <div key={g.name} className="flex items-center gap-2.5">
                      <span className="truncate" style={{ width: 150, fontSize: 12.5, flex: "0 0 auto" }}>{g.name}</span>
                      <div className="fr-matchbar" style={{ flex: 1 }}><i style={{ width: `${(g.count / derived.topGenres[0].count) * 100}%` }} /></div>
                      <span className="mute" style={{ fontSize: 11.5, width: 24, textAlign: "right", flex: "0 0 auto" }}>{g.count}</span>
                    </div>
                  ))}
                </div>
                {derived.topNetworks.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="mute" style={{ fontSize: 11.5 }}>Top networks:</span>
                    {derived.topNetworks.map((n) => (
                      <span key={n.name} className="badge badge-soft" style={{ fontSize: 11 }}>{n.name} · {n.count}</span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {section === "watching" && (
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow flex items-center gap-1.5"><Play size={13} />Watching now</div>
            {snap.watching.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>Nothing in rotation — no episodes watched in the last two months.</p>
              </div>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {snap.watching.map((w) => {
                  const p = w.watched != null && w.aired != null
                    ? { watched: w.watched, aired: w.aired }
                    : progressMap?.get(w.tmdb_id);
                  const pct = p && p.aired > 0 ? Math.min(100, Math.round((p.watched / p.aired) * 100)) : null;
                  return (
                    <div key={w.tmdb_id} className="card mq-row" onClick={() => openTitle(w.tmdb_id)}>
                      <MiniArt poster={w.poster_path} name={w.name} style={{ width: 52, height: 76 }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{w.name}</div>
                        <div className="dim" style={{ fontSize: 12.5 }}>
                          On S{w.season_number} · E{w.episode_number}
                          {w.last_watched_at ? <span className="mute"> · watched {relativeTime(w.last_watched_at)}</span> : null}
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
                })}
              </div>
            )}
          </section>
        )}

        {section === "shows" && (
          <>
            {derived && derived.sharedFollows.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <div className="eyebrow">You both follow · {derived.sharedFollows.length}</div>
                <div className="fr-grid">
                  {derived.sharedFollows.map((f) => (
                    <div key={f.tmdb_id} className="fr-show">
                      <div className="fr-mini fr-common" style={{ background: posterBg(f.name) }} title={f.name} onClick={() => openTitle(f.tmdb_id)}>
                        {tmdbImg(f.poster_path, "w342") && <img src={tmdbImg(f.poster_path, "w342")} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                        <span className="fr-mini-name">{f.name}</span>
                      </div>
                      {(() => { const p = progressMap?.get(f.tmdb_id); return p && p.aired > 0 ? <ProgressStrip watched={p.watched} aired={p.aired} /> : null; })()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fp && fp.follows.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="eyebrow">Everything they follow · {fp.follows.length}</div>
                  <div className="flex items-center gap-2">
                    <select className="year-select" value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Filter by genre">
                      <option value="">All genres</option>
                      {followGenres.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select className="year-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                      <option value="name">A–Z</option>
                      <option value="year">Newest</option>
                      <option value="rating">Top rated</option>
                    </select>
                  </div>
                </div>
                {browseFollows.length === 0 ? (
                  <p className="dim" style={{ fontSize: 13, margin: 0 }}>Nothing in that genre.</p>
                ) : (
                  <div className="fr-grid">
                    {browseFollows.map((f) => (
                      <FollowTile
                        key={f.tmdb_id}
                        f={f}
                        theirScore={theirScoreByTmdb.get(f.tmdb_id)}
                        progress={progressMap?.get(f.tmdb_id)}
                        added={myFollowIds.has(f.tmdb_id)}
                        onOpen={() => openTitle(f.tmdb_id)}
                        onAdd={() => follow.mutate(toTitleRow(f))}
                      />
                    ))}
                  </div>
                )}
                <span className="mute" style={{ fontSize: 11.5 }}>Ring = you follow it too · <Plus size={11} style={{ verticalAlign: "-1px" }} /> adds to your library · bar = their progress.</span>
              </section>
            )}
          </>
        )}

        {section === "activity" && (
          <section className="flex flex-col gap-1.5">
            <div className="eyebrow flex items-center gap-1.5"><Activity size={13} />Recent activity</div>
            {!derived || derived.activity.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>No activity yet.</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 6 }}>
                {derived.activity.map((a, i) => (
                  <div key={`${a.kind}-${a.tmdb_id}-${i}`} className="fr-activity" onClick={() => openTitle(a.tmdb_id)} style={{ cursor: "pointer" }}>
                    <span className="badge badge-soft btn-icon" style={{ width: 30, height: 30, flex: "0 0 auto" }}>
                      {a.kind === "rated" ? <Star size={14} style={{ color: "var(--accent)" }} /> : <Plus size={14} />}
                    </span>
                    <div className="min-w-0 flex-1" style={{ fontSize: 13.5 }}>
                      <span className="mute">{a.kind === "rated" ? "Rated" : "Added"} </span>
                      <b style={{ fontWeight: 700 }}>{a.name}</b>
                      {a.kind === "rated" && a.score != null && <span className="mute"> · {a.score}/10</span>}
                    </div>
                    <span className="mute" style={{ fontSize: 12, flex: "0 0 auto" }}>{relativeTime(a.at)}</span>
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
                <div className="eyebrow">Their top ratings</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {derived.topRated.map((r) => (
                    <div key={r.tmdb_id} className="card mq-row" onClick={() => openTitle(r.tmdb_id)}>
                      <MiniArt poster={r.poster_path} name={r.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{r.name}</div>
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
                <div className="eyebrow">You both rated · {derived.coRated.length}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {derived.coRated.slice(0, 8).map((c) => (
                    <div key={c.tmdb_id} className="card mq-row" onClick={() => openTitle(c.tmdb_id)}>
                      <MiniArt poster={c.poster_path} name={c.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</div>
                        <div className="dim" style={{ fontSize: 12.5 }}>{agreementLabel(c.score, c.mine)}</div>
                      </div>
                      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
                        <span className="badge badge-soft" title="Their score" style={{ fontWeight: 800 }}>Them {c.score}</span>
                        <span className="badge badge-soft" title="Your score" style={{ fontWeight: 800 }}>You {c.mine}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {derived && derived.topRated.length === 0 && derived.coRated.length === 0 && (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>No ratings yet.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
