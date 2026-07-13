import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Activity, Check, Clock, Eye, Heart, Play, Plus, Star, Tv, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, Stars } from "@/ui";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { useFriendProfile, type FriendFollow } from "@/lib/friendProfile";
import { useLibrary, useFollow } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { timeSpentLabel } from "@/lib/stats";
import type { TitleRow } from "@/lib/schemas";

/* Friend profile sheet — enriched. rpc_friend_snapshot supplies the profile,
   episode counts and "watching now"; useFriendProfile adds their full follow
   list + ratings, from which the sheet builds the in-common, taste-profile,
   activity and browsable-follows sections. ?friend=<id> opens it; the show
   detail sheet stacks on top via ?title=. */

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
  watching: z.array(z.object({ tmdb_id: z.number(), name: z.string(), poster_path: z.string().nullable(), network: z.string().nullable(), season_number: z.number(), episode_number: z.number() })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

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

/* Relative "3d ago" / "2mo ago" for the activity feed. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  const days = Math.floor(ms / day);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function agreementLabel(theirs: number, mine: number): string {
  const d = Math.abs(theirs - mine);
  if (d === 0) return "Same score";
  if (d <= 1) return "You basically agree";
  if (d >= 4) return "You strongly disagree";
  return "Slightly different takes";
}

/* Poster tile in the browsable "Everything they follow" grid: their score
   (if rated), a common-ring when you follow it too, and a one-tap Add. */
function FollowTile({ f, theirScore, added, onOpen, onAdd }: { f: FriendFollow; theirScore?: number; added: boolean; onOpen: () => void; onAdd: () => void }) {
  const art = tmdbImg(f.poster_path, "w342");
  return (
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
  );
}

export function FriendSheet({ friendId, onClose }: { friendId: string; onClose: () => void }) {
  const [, setSearchParams] = useSearchParams();
  const trapRef = useFocusTrap<HTMLDivElement>();

  const { data: snap, isPending } = useQuery({
    queryKey: ["friendSnapshot", friendId],
    queryFn: async (): Promise<Snapshot | null> => {
      const { data, error } = await supabase.rpc("rpc_friend_snapshot", { p_friend: friendId });
      if (error) throw error;
      return data ? snapshotSchema.parse(data) : null;
    },
  });

  const { data: fp } = useFriendProfile(friendId);
  const { data: library = [] } = useLibrary();
  const { data: myRatings = [] } = useMyRatings();
  const follow = useFollow();

  const [genre, setGenre] = useState<string>("");
  const [sort, setSort] = useState<"name" | "year" | "rating">("name");

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

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

    const topRated = [...ratings].sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at)).slice(0, 6);

    type Act = { kind: "rated" | "added"; at: string; tmdb_id: number; name: string; poster_path: string | null; score?: number };
    const activity: Act[] = [
      ...ratings.map((r): Act => ({ kind: "rated", at: r.created_at, tmdb_id: r.tmdb_id, name: r.name, poster_path: r.poster_path, score: r.score })),
      ...follows.map((f): Act => ({ kind: "added", at: f.added_at, tmdb_id: f.tmdb_id, name: f.name, poster_path: f.poster_path })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

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

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={snap ? `${snap.profile.display_name}'s profile` : "Friend profile"}
        tabIndex={-1}
        className="sheet-center fixed z-[68] card overflow-hidden flex flex-col"
        style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(760px, 96vw)", maxHeight: "92vh", borderRadius: "var(--r-xl)" }}
      >
        <div className="relative" style={{ height: 116, flex: "0 0 auto", background: `linear-gradient(135deg, hsl(${hue} 55% 34%), hsl(${(hue + 50) % 360} 60% 18%))` }}>
          <div className="poster-sheen" />
          <button className="btn btn-icon badge-glass absolute" style={{ top: 12, right: 12, color: "#fff" }} onClick={onClose}><X size={18} /></button>
        </div>

        {isPending ? (
          <div className="p-6 dim">Loading…</div>
        ) : !snap ? (
          <div className="p-8" style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 750, fontSize: 16 }}>Profile not available</div>
            <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>This profile is private or not one of your friends.</p>
          </div>
        ) : (
          <>
            <div className="px-6" style={{ marginTop: -34 }}>
              <div className="flex items-end gap-4 flex-wrap">
                <FriendAvatar f={{ id: snap.profile.id, name: snap.profile.display_name, avatarUrl: snap.profile.avatar_url }} size={76} ring />
                <div className="pb-1 min-w-0">
                  <div style={{ fontSize: 21, fontWeight: 800 }}>{snap.profile.display_name}</div>
                  <div className="dim" style={{ fontSize: 13 }}>@{snap.profile.handle}{snap.profile.country ? ` · ${snap.profile.country}` : ""}</div>
                </div>
              </div>
              {snap.profile.bio && <p className="dim" style={{ fontSize: 13.5, margin: "10px 0 0" }}>{snap.profile.bio}</p>}
            </div>

            <div className="overflow-y-auto p-6 pt-4 flex flex-col gap-6">
              {/* Stats */}
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {[
                  { icon: Tv, label: "Shows", value: snap.stats.shows },
                  { icon: Eye, label: "Episodes", value: snap.stats.episodes.toLocaleString() },
                  { icon: Star, label: "Rated", value: snap.stats.rated },
                ].map((st) => (
                  <div key={st.label} className="card p-3 flex flex-col gap-0.5">
                    <st.icon size={16} style={{ color: "var(--accent)" }} />
                    <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{st.value}</div>
                    <div className="mute" style={{ fontSize: 11.5 }}>{st.label}</div>
                  </div>
                ))}
              </div>

              {/* Match + in common */}
              {derived && (
                <section className="flex flex-col gap-3">
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

                  {derived.sharedFollows.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="eyebrow">You both follow · {derived.sharedFollows.length}</div>
                      <div className="fr-grid">
                        {derived.sharedFollows.map((f) => (
                          <div key={f.tmdb_id} className="fr-mini fr-common" style={{ background: posterBg(f.name) }} title={f.name} onClick={() => openTitle(f.tmdb_id)}>
                            {tmdbImg(f.poster_path, "w92") && <img src={tmdbImg(f.poster_path, "w92")} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                            <span className="fr-mini-name">{f.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {derived.coRated.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="eyebrow">You both rated · {derived.coRated.length}</div>
                      {derived.coRated.slice(0, 6).map((c) => (
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
                  )}
                </section>
              )}

              {/* Watching now */}
              {snap.watching.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <div className="eyebrow flex items-center gap-1.5"><Play size={13} />Watching now</div>
                  {snap.watching.map((w) => (
                    <div key={w.tmdb_id} className="card mq-row" onClick={() => openTitle(w.tmdb_id)}>
                      <MiniArt poster={w.poster_path} name={w.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{w.name}</div>
                        <div className="dim" style={{ fontSize: 12.5 }}>On S{w.season_number} · E{w.episode_number}</div>
                      </div>
                      {w.network && <NetworkLogo network={w.network} size={11} />}
                    </div>
                  ))}
                </section>
              )}

              {/* Recent activity */}
              {derived && derived.activity.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <div className="eyebrow flex items-center gap-1.5"><Activity size={13} />Recent activity</div>
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
                      <span className="mute" style={{ fontSize: 12, flex: "0 0 auto" }}>{timeAgo(a.at)}</span>
                    </div>
                  ))}
                </section>
              )}

              {/* Their top ratings */}
              {derived && derived.topRated.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <div className="eyebrow">Their top ratings</div>
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
                </section>
              )}

              {/* Taste profile */}
              {derived && derived.topGenres.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div className="eyebrow">Taste profile</div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                    <div className="card p-3 flex flex-col gap-0.5">
                      <Clock size={16} style={{ color: "var(--accent)" }} />
                      <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">~{timeSpentLabel(estMinutes)}</div>
                      <div className="mute" style={{ fontSize: 11.5 }}>Est. watch time</div>
                    </div>
                    <div className="card p-3 flex flex-col gap-0.5">
                      <Star size={16} style={{ color: "var(--accent)" }} />
                      <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{derived.avgRating != null ? derived.avgRating.toFixed(1) : "—"}</div>
                      <div className="mute" style={{ fontSize: 11.5 }}>Avg. rating</div>
                    </div>
                  </div>
                  <div className="card p-4 flex flex-col gap-2">
                    {derived.topGenres.slice(0, 6).map((g) => (
                      <div key={g.name} className="flex items-center gap-2.5">
                        <span className="truncate" style={{ width: 128, fontSize: 12.5, flex: "0 0 auto" }}>{g.name}</span>
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

              {/* Everything they follow — browsable */}
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
                          added={myFollowIds.has(f.tmdb_id)}
                          onOpen={() => openTitle(f.tmdb_id)}
                          onAdd={() => follow.mutate(toTitleRow(f))}
                        />
                      ))}
                    </div>
                  )}
                  <span className="mute" style={{ fontSize: 11.5 }}>Ring = you follow it too · <Plus size={11} style={{ verticalAlign: "-1px" }} /> adds to your library.</span>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
