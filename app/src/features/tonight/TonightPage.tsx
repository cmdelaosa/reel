import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { orderByActivity, soonPremieres, recentlyAired } from "@/domain/tonight";
import { useCalendarFeed } from "@/lib/calendar";
import { CalEpRow } from "@/features/calendar/CalEpRow";
import { useUpNext, type UpNextRow } from "@/lib/upnext";
import { useMarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { Poster, Rail } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useTitleIntent } from "@/lib/useOpenTitle";

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
  const freshUnseen = freshFeed.filter((e) => e.watch_event_id == null).length;
  const hero = ordered[0];
  const heroMark = useMarkWatched(hero?.title_id ?? "");
  const rest = ordered.slice(1);
  const heroIntent = useTitleIntent(hero?.tmdb_id);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const heroProgress = hero && hero.aired_count > 0 ? Math.round((hero.watched_count / hero.aired_count) * 100) : 0;

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Tonight</h1>
        <p className="dim mq-sub">
          {isPending
            ? "Working out what's next…"
            : `${dateLabel} — ${freshUnseen} new ${freshUnseen === 1 ? "episode" : "episodes"} waiting, ${soon.length} premieres on the way.`}
        </p>
      </header>

      {hero && (
        <div className="mq-bento">
          <section className="card mq-hero" onClick={() => open(hero.tmdb_id)} {...heroIntent}>
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
          <Rail title="Continue watching" subtitle="Pick up where you left off" scrollToStartKey={followKey}>
            {rest.map((r) => (
              <ContinueCard key={r.title_id} r={r} onOpen={() => open(r.tmdb_id)} onMarked={() => setFollowKey((k) => k + 1)} />
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
            <Link to="/calendar" className="btn btn-ghost btn-sm">See all <ChevronRight size={14} /></Link>
          </div>
          <div className="flex flex-col gap-3">
            {freshFeed.length === 0 && <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>Nothing new in the last 5 days.</p>}
            {freshFeed.map((ep) => (
              <CalEpRow key={ep.episode_id} ep={ep} now={now} />
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
            {r.name} · {seLabel(r)}
          </div>
        </div>
        <MarkCheck episodeId={r.episode_id} mark={mark} label={`Mark ${r.name} ${seLabel(r)} watched`} onMarked={onMarked} />
      </div>
    </div>
  );
}
