import { useEffect, useState } from "react";
import { Check, Plus, Star, X } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { useLibrary, useFollow, useUnfollow } from "@/lib/library";
import type { SeasonRow } from "@/lib/schemas";
import { NetworkLogo } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useTitle, useSeasonEpisodes, useWatched } from "@/features/detail/data";

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

export function DetailSheet({ tmdbId, onClose }: { tmdbId: number; onClose: () => void }) {
  const { data, isPending } = useTitle(tmdbId);
  const { data: library = [] } = useLibrary();
  const follow = useFollow();
  const unfollow = useUnfollow();
  const [season, setSeason] = useState<number | null>(null);
  const [rating, setRating] = useState(0);

  const title = data?.title;
  const regularSeasons = (data?.seasons ?? []).filter((s: SeasonRow) => s.number > 0);
  const activeSeason = season ?? regularSeasons[0]?.number ?? null;
  const { data: seasonData } = useSeasonEpisodes(tmdbId, activeSeason);
  const { data: watched } = useWatched(title?.id ?? null);

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
              <div className="flex items-center gap-2.5 flex-wrap">
                <button className={`btn ${added ? "btn-outline" : "btn-accent"}`} onClick={toggleFollow}>
                  {added ? <><Check size={16} />Remove</> : <><Plus size={16} />Add</>}
                </button>
              </div>

              {/* Ratings — yours (persisted in P2-C5) + TMDB community */}
              <div className="card p-4 flex items-stretch gap-4">
                <div className="flex-1">
                  <div className="eyebrow" style={{ marginBottom: 7 }}>Your rating</div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {[2, 4, 6, 8, 10].map((v) => (
                        <Star
                          key={v}
                          size={24}
                          className="star"
                          style={{ color: v <= rating ? "var(--accent)" : "var(--text-mute)" }}
                          fill={v <= rating ? "currentColor" : "none"}
                          strokeWidth={v <= rating ? 0 : 1.6}
                          onClick={() => setRating(v)}
                        />
                      ))}
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{rating ? `${rating}/10` : "—"}</span>
                  </div>
                </div>
                <div style={{ width: 1, background: "var(--border)", flex: "0 0 auto" }} />
                <div style={{ textAlign: "center", minWidth: 92 }}>
                  <div className="eyebrow" style={{ marginBottom: 7 }}>TMDB</div>
                  <div className="flex items-center justify-center gap-1.5">
                    <Star size={18} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                    <span style={{ fontWeight: 850, fontSize: 19 }}>
                      {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div className="mute" style={{ fontSize: 11 }}>community</div>
                </div>
              </div>

              {title.overview && (
                <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{title.overview}</p>
              )}

              {title.network && (
                <div>
                  <div className="eyebrow mb-2.5">Where to watch</div>
                  <div className="flex gap-2 flex-wrap">
                    <span className="chip">{title.network}</span>
                  </div>
                </div>
              )}

              {/* Episodes */}
              {regularSeasons.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="eyebrow">Episodes</div>
                    <div className="segmented" style={{ flexWrap: "wrap" }}>
                      {regularSeasons.map((s) => (
                        <div key={s.number} className={`seg ${activeSeason === s.number ? "seg-active" : ""}`} onClick={() => setSeason(s.number)}>
                          S{s.number}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    {episodes.length === 0 && (
                      <div className="dim" style={{ fontSize: 13.5, padding: "10px 0" }}>Loading episodes…</div>
                    )}
                    {episodes.map((e) => {
                      const aired = Boolean(e.air_datetime && e.air_datetime <= now);
                      const isWatched = watched?.has(e.id) ?? false;
                      return (
                        <div key={e.id} className="ep-row" style={aired ? undefined : { opacity: 0.55, cursor: "default" }}>
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
    </>
  );
}
