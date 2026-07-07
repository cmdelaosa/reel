import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Eye, Heart, Star, Tv, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, Stars } from "@/ui";
import { FriendAvatar } from "@/ui/FriendAvatar";

/* Friend profile sheet — port of prototype friends.tsx FriendSheet on live
   data (rpc_friend_snapshot). Opened via ?friend=<profile_id>; the show detail
   sheet stacks on top via ?title=. */

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
  shared: z.number(),
  follows: z.array(z.object({ tmdb_id: z.number(), name: z.string(), poster_path: z.string().nullable(), common: z.boolean() })),
  ratings: z.array(z.object({ tmdb_id: z.number(), name: z.string(), poster_path: z.string().nullable(), score: z.number() })),
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

export function FriendSheet({ friendId, onClose }: { friendId: string; onClose: () => void }) {
  const [, setSearchParams] = useSearchParams();
  const { data, isPending } = useQuery({
    queryKey: ["friendSnapshot", friendId],
    queryFn: async (): Promise<Snapshot | null> => {
      const { data, error } = await supabase.rpc("rpc_friend_snapshot", { p_friend: friendId });
      if (error) throw error;
      return data ? snapshotSchema.parse(data) : null;
    },
  });

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

  const hue = hueOf(friendId);
  const s = data;
  const match = s && s.follows.length ? Math.round((s.shared / s.follows.length) * 100) : 0;

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        className="sheet-center fixed z-[68] card overflow-hidden flex flex-col"
        style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(680px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)" }}
      >
        <div className="relative" style={{ height: 116, flex: "0 0 auto", background: `linear-gradient(135deg, hsl(${hue} 55% 34%), hsl(${(hue + 50) % 360} 60% 18%))` }}>
          <div className="poster-sheen" />
          <button className="btn btn-icon badge-glass absolute" style={{ top: 12, right: 12, color: "#fff" }} onClick={onClose}><X size={18} /></button>
        </div>

        {isPending ? (
          <div className="p-6 dim">Loading…</div>
        ) : !s ? (
          <div className="p-8" style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 750, fontSize: 16 }}>Profile not available</div>
            <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>This profile is private or not one of your friends.</p>
          </div>
        ) : (
          <>
            <div className="px-6" style={{ marginTop: -34 }}>
              <div className="flex items-end gap-4 flex-wrap">
                <FriendAvatar f={{ id: s.profile.id, name: s.profile.display_name, avatarUrl: s.profile.avatar_url }} size={76} ring />
                <div className="pb-1 min-w-0">
                  <div style={{ fontSize: 21, fontWeight: 800 }}>{s.profile.display_name}</div>
                  <div className="dim" style={{ fontSize: 13 }}>@{s.profile.handle}{s.profile.country ? ` · ${s.profile.country}` : ""}</div>
                </div>
              </div>
              {s.profile.bio && <p className="dim" style={{ fontSize: 13.5, margin: "10px 0 0" }}>{s.profile.bio}</p>}
            </div>

            <div className="overflow-y-auto p-6 pt-4 flex flex-col gap-6">
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {[
                  { icon: Tv, label: "Shows", value: s.stats.shows },
                  { icon: Eye, label: "Episodes", value: s.stats.episodes.toLocaleString() },
                  { icon: Star, label: "Rated", value: s.stats.rated },
                ].map((st) => (
                  <div key={st.label} className="card p-3 flex flex-col gap-0.5">
                    <st.icon size={16} style={{ color: "var(--accent)" }} />
                    <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{st.value}</div>
                    <div className="mute" style={{ fontSize: 11.5 }}>{st.label}</div>
                  </div>
                ))}
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700 }}>
                    <Heart size={15} style={{ color: "var(--accent)" }} />{match}% match with you
                  </div>
                  <span className="mute" style={{ fontSize: 12.5 }}>{s.shared} shows in common</span>
                </div>
                <div className="fr-matchbar"><i style={{ width: `${match}%` }} /></div>
              </div>

              {s.watching.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <div className="eyebrow">Watching now</div>
                  {s.watching.map((w) => (
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

              {s.follows.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <div className="eyebrow">Follows · {s.follows.length} shows</div>
                  <div className="fr-grid">
                    {s.follows.map((t) => (
                      <div
                        key={t.tmdb_id}
                        className={`fr-mini ${t.common ? "fr-common" : ""}`}
                        style={{ background: posterBg(t.name) }}
                        title={t.common ? `${t.name} — you both follow this` : t.name}
                        onClick={() => openTitle(t.tmdb_id)}
                      >
                        {tmdbImg(t.poster_path, "w92") && <img src={tmdbImg(t.poster_path, "w92")} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                        <span className="fr-mini-name">{t.name}</span>
                      </div>
                    ))}
                  </div>
                  <span className="mute" style={{ fontSize: 11.5 }}>Highlighted = shows you both follow.</span>
                </section>
              )}

              {s.ratings.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <div className="eyebrow">Their top ratings</div>
                  {s.ratings.map((r) => (
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
            </div>
          </>
        )}
      </div>
    </>
  );
}
