import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { orderByActivity, soonPremieres, recentlyAired } from "@/domain/tonight";
import { useCalendarFeed } from "@/lib/calendar";
import { CalEpRow } from "@/features/calendar/CalEpRow";
import { useUpNext, type UpNextRow } from "@/lib/upnext";
import { useMarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { isEs, locName, t as tr, useEsNames } from "@/lib/i18n";
import { Poster, Rail } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useTitleIntent } from "@/lib/useOpenTitle";

/* Tonight — bento hero + continue rail + fresh/premieres. Port of prototype
   marquee.tsx → Tonight on live up-next data. */

const seLabel = (r: UpNextRow) => `S${r.season_number} · E${r.episode_number}`;

/** One line in the shape `S2 · E1 — “Future Days” · HBO · 54 min`, minus
 *  whatever the row is missing — episode name, network and runtime are each
 *  nullable, so drop empty pieces rather than leaving a dangling separator. */
function metaLine(r: UpNextRow): string {
  const ep = r.episode_name ? `${seLabel(r)} — “${r.episode_name}”` : seLabel(r);
  return [ep, r.network, r.runtime ? `${r.runtime} ${tr("min")}` : null].filter(Boolean).join(" · ");
}

function airLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return tr("New today");
  if (days === 1) return tr("Aired yesterday");
  if (days <= 7) return isEs() ? `Emitido hace ${days} días` : `Aired ${days} days ago`;
  return null;
}


export default function TonightPage() {
  const { data: upNext = [], isPending } = useUpNext();
  const { data: feed = [] } = useCalendarFeed(1);
  const [, setSearchParams] = useSearchParams();
  // bumped after marking from the continue rail → smooth-scroll it back to the
  // front, following the just-marked show to its new position.
  const [followKey, setFollowKey] = useState(0);

  const now = new Date();
  // One continue-watching order by effective activity (most recent watch OR
  // newly-aired next episode). The top of that list is the hero; the rest fill
  // the rail.
  const ordered = orderByActivity(upNext);
  const soon = soonPremieres(feed, now).slice(0, 6);
  // Fresh episodes = everything a followed show aired in the last 5 days (from
  // the calendar feed), newest first — independent of the per-show up-next.
  const freshFeed = recentlyAired(feed, now);
  const hero = ordered[0];
  const heroMark = useMarkWatched(hero?.title_id ?? "");
  const rest = ordered.slice(1);
  const heroIntent = useTitleIntent(hero?.tmdb_id);
  const heroEsNames = useEsNames();

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const heroProgress = hero && hero.aired_count > 0 ? Math.round((hero.watched_count / hero.aired_count) * 100) : 0;
  const heroAir = hero ? airLabel(hero.air_datetime) : null;
  // Landscape still for the banner; the portrait poster is the fallback for the
  // ~3% of titles TMDB has no backdrop for (cropped hard, but never a blank box).
  const heroArt = hero ? (tmdbImg(hero.backdrop_path, "w780") ?? tmdbImg(hero.poster_path, "w780")) : undefined;

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">{tr("Tonight")}</h1>
      </header>

      {hero && (
        <div className="mq-bento">
          <section className="card mq-hero" onClick={() => open(hero.tmdb_id)} {...heroIntent} style={{ background: posterBg(hero.name) }}>
            {heroArt && <img className="mq-hero-still" src={heroArt} alt="" />}
            {heroAir && <span className="mq-hero-flag">{heroAir}</span>}
            <div className="mq-hero-body">
              <div className="mq-hero-eyebrow">{tr("Up next for you")}</div>
              <h2 className="mq-hero-title">{locName(heroEsNames, hero.tmdb_id, hero.name)}</h2>
              <div className="mq-hero-meta">{metaLine(hero)}</div>
              <div className="mq-hero-progress">
                <span className="mq-hero-track"><i style={{ width: `${heroProgress}%` }} /></span>
                <span className="mq-hero-count">
                  {hero.watched_count}/{hero.aired_count} {tr("episodes")} · {heroProgress}{tr("% done")}
                </span>
              </div>
              <div className="mq-hero-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-accent btn-sm" onClick={() => heroMark.mutate(hero.episode_id)}>
                  <Check size={14} />{tr("Mark watched")}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => open(hero.tmdb_id)}>{tr("Details")}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {!isPending && !hero && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {isEs()
              ? <>Nada en marcha — añade una serie con <kbd className="mq-kbd">⌘K</kbd> y marca por dónde vas.</>
              : <>Nothing in progress — add a show with <kbd className="mq-kbd">⌘K</kbd> and mark where you are.</>}
          </p>
        </div>
      )}

      {rest.length > 0 && (
        <section className="flex flex-col gap-4">
          <Rail title={tr("Continue watching")} scrollToStartKey={followKey}>
            {rest.map((r) => (
              <ContinueCard key={r.title_id} r={r} onOpen={() => open(r.tmdb_id)} onMarked={() => setFollowKey((k) => k + 1)} />
            ))}
          </Rail>
        </section>
      )}

      <div className="mq-cols">
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("Fresh episodes")}</h2>
            <Link to="/calendar" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {freshFeed.length === 0 && <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("Nothing new in the last 5 days.")}</p>}
            {freshFeed.map((ep) => (
              <CalEpRow key={ep.episode_id} ep={ep} now={now} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("Premieres soon")}</h2>
            <Link to="/calendar" className="btn btn-ghost btn-sm">{tr("See all")} <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {soon.length === 0 && <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("No dated premieres yet.")}</p>}
            {soon.map((ep) => (
              <CalEpRow key={ep.episode_id} ep={ep} now={now} later />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Check button that fills with a pop before the mark actually lands — the
 *  optimistic mark + up-next refetch is otherwise instant, so the confirmation
 *  never registers. Delaying the mutate ~420ms lets the fill play. `marked` is
 *  derived by comparing the clicked episode to the current one, so when the card
 *  advances to the next episode it resets on its own (no stale filled state). */
function MarkCheck({ episodeId, mark, label, onMarked }: {
  episodeId: string;
  mark: ReturnType<typeof useMarkWatched>;
  label: string;
  onMarked?: () => void;
}) {
  const [markedEp, setMarkedEp] = useState<string | null>(null);
  const marked = markedEp === episodeId;
  return (
    <button
      className={`check ${marked ? "on pop" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (marked) return;
        setMarkedEp(episodeId);
        // Reset the fill if the mark fails, otherwise the check stays lit while
        // the episode never actually advanced (the mutation rolls the data back).
        setTimeout(() => {
          mark.mutate(episodeId, { onError: () => setMarkedEp(null) });
          onMarked?.();
        }, 420);
      }}
      title={label}
      aria-label={label}
    >
      <Check size={15} strokeWidth={3} />
    </button>
  );
}

/** Continue-watching tile: show art, but the caption is the concrete next
 *  episode, with a check to mark it watched in place (the rail then advances
 *  via the upNext refetch). */
function ContinueCard({ r, onOpen, onMarked }: { r: UpNextRow; onOpen: () => void; onMarked?: () => void }) {
  const mark = useMarkWatched(r.title_id);
  const esNames = useEsNames();
  const showName = locName(esNames, r.tmdb_id, r.name);
  return (
    <div style={{ width: "var(--rail-pw)" }} className="flex flex-col gap-2">
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
        prefetchTmdbId={r.tmdb_id}
        onClick={onOpen}
      />
      <div className="flex items-center gap-2 px-0.5">
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 13.5, fontWeight: 650 }} className="truncate">
            {r.episode_name ?? seLabel(r)}
          </div>
          <div className="mute truncate" style={{ fontSize: 12 }}>
            {showName} · {seLabel(r)}
          </div>
        </div>
        <MarkCheck episodeId={r.episode_id} mark={mark} label={`Mark ${showName} ${seLabel(r)} watched`} onMarked={onMarked} />
      </div>
    </div>
  );
}
