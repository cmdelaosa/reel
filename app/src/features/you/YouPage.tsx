import { useState } from "react";
import { useSearchParams } from "react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Eye, Share2, Star, Tv, Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useMyRatings, type RatedRow } from "@/lib/ratings";
import { useUserStats, timeSpentLabel } from "@/lib/stats";
import { tmdbImg } from "@/lib/tmdb";
import { Stars } from "@/ui";
import { StatsSkeleton } from "@/ui/Skeleton";
import { posterBg } from "@/ui/posterBg";

/* You — profile header + your ratings (sort + 15/page). Port of prototype
   marquee.tsx → You; the stats grid lands in P2-C9. */

const RATE_PAGE = 15;
type RateSort = "new" | "old" | "best" | "worst";

function ratedAtLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function RatingRow({ r, onOpen }: { r: RatedRow; onOpen: () => void }) {
  const t = r.titles;
  const art = tmdbImg(t.poster_path, "w92");
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(t.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate" style={{ marginTop: 0 }}>{t.name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {[t.first_air_date?.slice(0, 4), t.genres[0], `rated ${ratedAtLabel(r.created_at)}`].filter(Boolean).join(" · ")}
        </div>
        <div style={{ marginTop: 4 }}><Stars score={r.score} size={13} /></div>
      </div>
      <div className="mq-score">{r.score}<span>/10</span></div>
    </div>
  );
}

export default function YouPage() {
  const { profile } = useAuth();
  const { data: ratings = [] } = useMyRatings();
  const { data: stats } = useUserStats();
  const [sort, setSort] = useState<RateSort>("new");
  const [page, setPage] = useState(0);
  const [, setSearchParams] = useSearchParams();

  const byNew = (a: RatedRow, b: RatedRow) => b.created_at.localeCompare(a.created_at);
  const rated = [...ratings].sort((a, b) => {
    if (sort === "new") return byNew(a, b);
    if (sort === "old") return -byNew(a, b);
    if (sort === "best") return b.score - a.score || byNew(a, b);
    return a.score - b.score || byNew(a, b);
  });

  const pageCount = Math.max(1, Math.ceil(rated.length / RATE_PAGE));
  const clamped = Math.min(page, pageCount - 1);
  const start = clamped * RATE_PAGE;
  const shown = rated.slice(start, start + RATE_PAGE);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const sorts: { v: RateSort; label: string }[] = [
    { v: "new", label: "Newest" },
    { v: "old", label: "Oldest" },
    { v: "best", label: "Best rated" },
    { v: "worst", label: "Worst rated" },
  ];

  const initial = (profile?.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="screen mq-page">
      <div className="card overflow-hidden">
        <div className="profile-cover" />
        <div className="px-6 pb-6" style={{ marginTop: -44 }}>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex items-end gap-4">
              <div className="profile-avatar grid place-items-center overflow-hidden">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  initial
                )}
              </div>
              <div className="pb-1">
                <div style={{ fontSize: 22, fontWeight: 800 }}>{profile?.display_name}</div>
                <div className="dim" style={{ fontSize: 13.5 }}>@{profile?.handle}</div>
              </div>
            </div>
            <button className="btn btn-outline" title="Sharing lands with friends (Phase 4)">
              <Share2 size={16} />Share profile
            </button>
          </div>
        </div>
      </div>

      {!stats && <StatsSkeleton />}
      {stats && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[
            { icon: Eye, label: "Episodes watched", value: stats.episodes_watched.toLocaleString() },
            { icon: Clock, label: "Time spent", value: timeSpentLabel(stats.minutes_watched) },
            { icon: Tv, label: "Shows followed", value: String(stats.shows_followed) },
            { icon: CalendarClock, label: "Coming soon", value: String(stats.coming_soon) },
            { icon: Users, label: "Friends", value: String(stats.friends) },
            { icon: Star, label: "Avg. rating", value: stats.avg_rating != null ? stats.avg_rating.toFixed(1) : "—" },
          ].map((s) => (
            <div key={s.label} className="card p-4 flex flex-col gap-1">
              <s.icon size={18} style={{ color: "var(--accent)" }} />
              <div style={{ fontSize: 22, fontWeight: 800 }} className="mt-1">{s.value}</div>
              <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">Your ratings</h2>
            <p className="mute" style={{ fontSize: 13 }}>{rated.length} shows scored</p>
          </div>
        </div>

        <div className="mq-rate-toolbar">
          <div className="segmented" style={{ flexWrap: "wrap" }}>
            {sorts.map((s) => (
              <div key={s.v} className={`seg ${sort === s.v ? "seg-active" : ""}`} onClick={() => { setSort(s.v); setPage(0); }}>
                {s.label}
              </div>
            ))}
          </div>
          {rated.length > 0 && (
            <span className="mute" style={{ fontSize: 12.5 }}>
              {start + 1}–{Math.min(start + RATE_PAGE, rated.length)} of {rated.length}
            </span>
          )}
        </div>

        {rated.length === 0 && (
          <div className="card" style={{ padding: "28px 24px" }}>
            <p className="dim" style={{ margin: 0, fontSize: 14 }}>
              No ratings yet — open a show and tap the stars.
            </p>
          </div>
        )}

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {shown.map((r) => (
            <RatingRow key={r.id} r={r} onOpen={() => open(r.titles.tmdb_id)} />
          ))}
        </div>

        {pageCount > 1 && (
          <div className="mq-pager">
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === 0}
              style={{ opacity: clamped === 0 ? 0.4 : 1, pointerEvents: clamped === 0 ? "none" : "auto" }}
              onClick={() => setPage(clamped - 1)}
            >
              <ChevronLeft size={15} />Prev
            </button>
            <span>Page {clamped + 1} of {pageCount}</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === pageCount - 1}
              style={{ opacity: clamped === pageCount - 1 ? 0.4 : 1, pointerEvents: clamped === pageCount - 1 ? "none" : "auto" }}
              onClick={() => setPage(clamped + 1)}
            >
              Next<ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
