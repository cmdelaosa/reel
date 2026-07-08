import { Link, useSearchParams } from "react-router";
import { CalendarClock, Check, ChevronRight, Clapperboard, Flame, Tv } from "lucide-react";
import { splitTonight, premieresSoon, premiereMs } from "@/domain/tonight";
import { useLibrary, type LibraryShow } from "@/lib/library";
import { useUpNext, type UpNextRow } from "@/lib/upnext";
import { useMarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, Poster, Rail } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* Tonight — bento hero + continue rail + fresh/premieres. Port of prototype
   marquee.tsx → Tonight on live up-next data. */

const seLabel = (r: UpNextRow) => `S${r.season_number} · E${r.episode_number}`;

function airLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "New today";
  if (days === 1) return "Aired yesterday";
  if (days <= 7) return `Aired ${days} days ago`;
  return null;
}

function RowArt({ poster, name }: { poster: string | null; name: string }) {
  const art = tmdbImg(poster, "w92");
  return (
    <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
      {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      <div className="poster-sheen" />
    </div>
  );
}

export default function TonightPage() {
  const { data: upNext = [], isPending } = useUpNext();
  const { data: library = [] } = useLibrary();
  const [, setSearchParams] = useSearchParams();

  const now = new Date();
  const { fresh, cont } = splitTonight(upNext, now);
  const soon = premieresSoon(library, now).slice(0, 6);
  const hero = fresh[0] ?? cont[0];
  const heroMark = useMarkWatched(hero?.title_id ?? "");
  const rest = cont.filter((r) => r.title_id !== hero?.title_id);
  // drop the hero from the Fresh list so it isn't shown twice (it's fresh[0]
  // whenever there's any fresh episode).
  const freshRest = fresh.filter((r) => r.title_id !== hero?.title_id);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const heroProgress = hero && hero.aired_count > 0 ? Math.round((hero.watched_count / hero.aired_count) * 100) : 0;

  const stats = [
    { icon: Clapperboard, label: "Fresh this week", value: fresh.length },
    { icon: Tv, label: "Following", value: library.length },
    { icon: Flame, label: "Shows in progress", value: upNext.length },
    { icon: CalendarClock, label: "Premieres soon", value: soon.length },
  ];

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Tonight</h1>
        <p className="dim mq-sub">
          {isPending
            ? "Working out what's next…"
            : `${dateLabel} — ${fresh.length} new ${fresh.length === 1 ? "episode" : "episodes"} waiting, ${soon.length} premieres on the way.`}
        </p>
      </header>

      {hero && (
        <div className="mq-bento">
          <section className="card mq-hero" onClick={() => open(hero.tmdb_id)}>
            <div className="mq-hero-art" style={{ background: posterBg(hero.name) }}>
              {tmdbImg(hero.poster_path) && (
                <img src={tmdbImg(hero.poster_path)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              )}
              <div className="poster-sheen" />
            </div>
            <div className="mq-hero-body">
              <div className="eyebrow">Up next for you</div>
              <h2 className="mq-hero-ep">{hero.episode_name ?? seLabel(hero)}</h2>
              <div className="mq-hero-show">
                {hero.name} — {seLabel(hero)}
                {airLabel(hero.air_datetime) && (
                  <span className="badge badge-accent" style={{ marginLeft: 10 }}>{airLabel(hero.air_datetime)}</span>
                )}
              </div>
              <div className="mq-hero-track"><i style={{ width: `${heroProgress}%` }} /></div>
              <div className="mq-hero-meta mute">
                {hero.watched_count}/{hero.aired_count} episodes · {heroProgress}% done
              </div>
              <div className="mq-hero-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-accent" onClick={() => heroMark.mutate(hero.episode_id)}>
                  <Check size={16} />Mark watched
                </button>
                <button className="btn btn-outline" onClick={() => open(hero.tmdb_id)}>Details</button>
              </div>
            </div>
          </section>

          <section className="mq-statgrid">
            {stats.map((s) => (
              <div key={s.label} className="card mq-stat">
                <div className="mq-stat-ico"><s.icon size={17} /></div>
                <div className="mq-stat-val">{s.value}</div>
                <div className="mq-stat-label mute">{s.label}</div>
              </div>
            ))}
          </section>
        </div>
      )}

      {!isPending && !hero && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            Nothing in progress — add a show with <kbd className="mq-kbd">⌘K</kbd> and mark where you are.
          </p>
        </div>
      )}

      {rest.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <div>
              <h2 className="section-title">Continue watching</h2>
              <p className="mute" style={{ fontSize: 13 }}>Pick up where you left off</p>
            </div>
          </div>
          <Rail>
            {rest.map((r) => (
              <div key={r.title_id} style={{ width: "var(--rail-pw)" }} className="flex flex-col gap-2">
                <Poster
                  t={{
                    id: String(r.tmdb_id),
                    name: r.name,
                    year: "",
                    genres: [seLabel(r)],
                    network: r.network ?? "",
                    posterPath: tmdbImg(r.poster_path),
                    voteAverage: r.vote_average ?? 0,
                    progress: r.aired_count > 0 ? Math.round((r.watched_count / r.aired_count) * 100) : undefined,
                  }}
                  subtitle={seLabel(r)}
                  onClick={() => open(r.tmdb_id)}
                />
                <div className="px-0.5">
                  <div style={{ fontSize: 13.5, fontWeight: 650 }} className="truncate">{r.name}</div>
                  <div className="mute truncate" style={{ fontSize: 12 }}>{r.episode_name ?? seLabel(r)}</div>
                </div>
              </div>
            ))}
          </Rail>
        </section>
      )}

      <div className="mq-cols">
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <div>
              <h2 className="section-title">Fresh episodes</h2>
              <p className="mute" style={{ fontSize: 13 }}>Just aired from shows you follow</p>
            </div>
            <Link to="/shows" className="btn btn-ghost btn-sm">See all <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {fresh.length === 0 && <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>Nothing new this week.</p>}
            {freshRest.map((r) => (
              <FreshRow key={r.title_id} r={r} onOpen={() => open(r.tmdb_id)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <div>
              <h2 className="section-title">Premieres soon</h2>
              <p className="mute" style={{ fontSize: 13 }}>Dated within the next 60 days</p>
            </div>
            <Link to="/calendar" className="btn btn-ghost btn-sm">See all <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {soon.length === 0 && <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>No dated premieres yet.</p>}
            {soon.map((s) => (
              <SoonRow key={s.title_id} s={s} onOpen={() => open(s.tmdb_id)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function FreshRow({ r, onOpen }: { r: UpNextRow; onOpen: () => void }) {
  const mark = useMarkWatched(r.title_id);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <RowArt poster={r.poster_path} name={r.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge badge-accent">New</span>
          {r.network && <NetworkLogo network={r.network} />}
        </div>
        <div className="mq-row-title truncate">{r.name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          S{r.season_number} E{r.episode_number}{r.episode_name ? ` · ${r.episode_name}` : ""}
        </div>
      </div>
      <button
        className="check"
        onClick={(e) => { e.stopPropagation(); mark.mutate(r.episode_id); }}
        title="Mark watched"
      >
        <Check size={15} strokeWidth={3} />
      </button>
    </div>
  );
}

function SoonRow({ s, onOpen }: { s: LibraryShow; onOpen: () => void }) {
  const at = premiereMs(s);
  const label = at
    ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "TBA";
  return (
    <div className="card mq-row" onClick={onOpen}>
      <RowArt poster={s.poster_path} name={s.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge badge-accent">{label}</span>
          {s.network && <NetworkLogo network={s.network} />}
        </div>
        <div className="mq-row-title truncate">{s.name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {s.genres.slice(0, 2).join(" · ") || "Premiere"}
        </div>
      </div>
    </div>
  );
}
