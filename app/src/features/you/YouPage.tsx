import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, Clock, Eye, Film, History, LayoutGrid, Share2, Star, Tv, Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useLibrary } from "@/lib/library";
import { useMyRatings, type RatedRow } from "@/lib/ratings";
import { useUserStats, timeSpentLabel } from "@/lib/stats";
import { tmdbImg } from "@/lib/tmdb";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { Stars } from "@/ui";
import { StatsSkeleton } from "@/ui/Skeleton";
import { hueOf, posterBg } from "@/ui/posterBg";
import { WatchHeatmap } from "@/features/you/WatchHeatmap";

/* You — profile header + your ratings (sort + 15/page). Port of prototype
   marquee.tsx → You; the stats grid lands in P2-C9. */

const RATE_PAGE = 15;
type RateSort = "new" | "old" | "best" | "worst";

function ratedAtLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return tr("today");
  if (days === 1) return tr("yesterday");
  if (days < 30) return tv("{days} days ago", { days });
  return new Date(iso).toLocaleDateString(dateLocale(), { month: "short", year: "numeric" });
}

function RatingRow({ r, onOpen }: { r: RatedRow; onOpen: () => void }) {
  const t = r.titles;
  const art = tmdbImg(t.poster_path, "w92");
  const esNames = useEsNames();
  const name = locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="mq-row-title truncate" style={{ marginTop: 0 }}>{name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? ""), `${tr("rated")} ${ratedAtLabel(r.created_at)}`].filter(Boolean).join(" · ")}
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
  const { data: library = [] } = useLibrary();
  const [sort, setSort] = useState<RateSort>("new");
  const [page, setPage] = useState(0);
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

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
    { v: "new", label: tr("Newest") },
    { v: "old", label: tr("Oldest") },
    { v: "best", label: tr("Best rated") },
    { v: "worst", label: tr("Worst rated") },
  ];

  // Your taste profile — genre + network mix across the shows you follow,
  // same aggregation the friend page shows for others (friendProfile derived).
  const taste = useMemo(() => {
    const genreCounts = new Map<string, number>();
    for (const s of library) for (const g of s.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

    const netCounts = new Map<string, number>();
    for (const s of library) if (s.network) netCounts.set(s.network, (netCounts.get(s.network) ?? 0) + 1);
    const topNetworks = [...netCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

    return { topGenres, topNetworks };
  }, [library]);

  const initial = (profile?.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="screen mq-page">
      <div
        className="card profile-head overflow-hidden"
        style={{ "--fr-hue": hueOf(profile?.id ?? "") } as React.CSSProperties}
      >
        <div className="p-6">
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
            <button className="btn btn-outline" title={tr("Sharing lands with friends (Phase 4)")}>
              <Share2 size={16} />{tr("Share profile")}
            </button>
          </div>
        </div>
      </div>

      {/* My Shows + History moved off the top tabs — they live here now */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {[
          { icon: LayoutGrid, label: tr("My Shows"), sub: `${library.length} ${tr("in your library")}`, path: "/shows" },
          { icon: History, label: tr("History"), sub: tr("Everything you've watched"), path: "/history" },
        ].map((l) => (
          <button
            key={l.path}
            className="card p-4 flex items-center gap-3 text-left"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(l.path)}
          >
            <span
              className="grid place-items-center"
              style={{
                width: 38, height: 38, borderRadius: "var(--r-sm)", flex: "0 0 auto",
                background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)",
              }}
            >
              <l.icon size={18} />
            </span>
            <span className="flex-1 min-w-0">
              <span style={{ display: "block", fontWeight: 750, fontSize: 15 }}>{l.label}</span>
              <span className="mute" style={{ display: "block", fontSize: 12.5 }}>{l.sub}</span>
            </span>
            <ChevronRight size={17} className="mute" />
          </button>
        ))}
      </div>

      {!stats && <StatsSkeleton />}
      {stats && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[
            /* Cine y series cuentan por separado (0069): una película no es un
               episodio, y sumarlas bajo una etiqueta sola es lo que hacía falsa
               la cifra. Los minutos sí van juntos — son minutos, y no cambian
               de unidad al cambiar de medio.
               Las dos de cine solo se pintan si tienes algo: a quien solo ve
               series, dos ceros permanentes le dicen menos que nada. */
            { icon: Eye, label: tr("Episodes watched"), value: stats.episodes_watched.toLocaleString() },
            ...(stats.movies_watched > 0
              ? [{ icon: Film, label: tr("Movies watched"), value: stats.movies_watched.toLocaleString() }]
              : []),
            { icon: Clock, label: tr("Time spent"), value: timeSpentLabel(stats.minutes_watched) },
            { icon: Tv, label: tr("Shows followed"), value: String(stats.shows_followed) },
            ...(stats.movies_followed > 0
              ? [{ icon: Clapperboard, label: tr("Movies in your list"), value: String(stats.movies_followed) }]
              : []),
            { icon: CalendarClock, label: tr("Coming soon"), value: String(stats.coming_soon) },
            { icon: Users, label: tr("Friends"), value: String(stats.friends) },
            { icon: Star, label: tr("Avg. rating"), value: stats.avg_rating != null ? stats.avg_rating.toFixed(1) : "—" },
          ].map((s) => (
            <div key={s.label} className="card p-4 flex flex-col gap-1">
              <s.icon size={18} style={{ color: "var(--accent)" }} />
              <div style={{ fontSize: 22, fontWeight: 800 }} className="mt-1">{s.value}</div>
              <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <section className="taste-grid">
        {taste.topGenres.length > 0 && (
          <div className="taste-col">
            <div className="eyebrow">{tr("Taste profile")}</div>
            <div className="card p-4 flex flex-col gap-2">
              {taste.topGenres.slice(0, 8).map((g) => (
                <div key={g.name} className="flex items-center gap-2.5">
                  <span className="truncate" style={{ width: 150, fontSize: 12.5, flex: "0 0 auto" }}>{tGenre(g.name)}</span>
                  <div className="fr-matchbar" style={{ flex: 1 }}><i style={{ width: `${(g.count / taste.topGenres[0].count) * 100}%` }} /></div>
                  <span className="mute" style={{ fontSize: 11.5, width: 24, textAlign: "right", flex: "0 0 auto" }}>{g.count}</span>
                </div>
              ))}
            </div>
            {taste.topNetworks.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {taste.topNetworks.map((n) => (
                  <span key={n.name} className="badge badge-soft" style={{ fontSize: 11 }}>{n.name} · {n.count}</span>
                ))}
              </div>
            )}
          </div>
        )}
        <WatchHeatmap />
      </section>

      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">{tr("Your ratings")}</h2>
          </div>
        </div>

        <div className="mq-rate-toolbar">
          <div className="segmented scroll no-scrollbar">
            {sorts.map((s) => (
              <div key={s.v} className={`seg ${sort === s.v ? "seg-active" : ""}`} onClick={() => { setSort(s.v); setPage(0); }}>
                {s.label}
              </div>
            ))}
          </div>
          {rated.length > 0 && (
            <span className="mute" style={{ fontSize: 12.5 }}>
              {start + 1}–{Math.min(start + RATE_PAGE, rated.length)} {tr("of")} {rated.length}
            </span>
          )}
        </div>

        {rated.length === 0 && (
          <div className="card" style={{ padding: "28px 24px" }}>
            <p className="dim" style={{ margin: 0, fontSize: 14 }}>
              {tr("No ratings yet — open a show and tap the stars.")}
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
              <ChevronLeft size={15} />{tr("Prev")}
            </button>
            <span>{tr("Page")} {clamped + 1} {tr("of")} {pageCount}</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={clamped === pageCount - 1}
              style={{ opacity: clamped === pageCount - 1 ? 0.4 : 1, pointerEvents: clamped === pageCount - 1 ? "none" : "auto" }}
              onClick={() => setPage(clamped + 1)}
            >
              {tr("Next")}<ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
