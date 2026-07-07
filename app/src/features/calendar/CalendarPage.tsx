import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Bell, Check, ChevronRight } from "lucide-react";
import { dayLabel, dayOffset, episodeBadge, groupFeed } from "@/domain/calendar";
import { premiereMs } from "@/domain/tonight";
import { useCalendarFeed, type FeedRow } from "@/lib/calendar";
import { useLibrary, type LibraryShow } from "@/lib/library";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* Calendar — chronological my-shows feed with lazy history, plus returning /
   new views. Port of prototype marquee.tsx CalendarTab/MyShowsFeed/CalEpRow/
   PremieresList, including the IntersectionObserver + useLayoutEffect
   scroll-preservation approach. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function useOpenTitle() {
  const [, setSearchParams] = useSearchParams();
  return (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });
}

export default function CalendarPage() {
  const [view, setView] = useState<"shows" | "returning" | "new">("shows");
  const tabs: [typeof view, string][] = [
    ["shows", "My shows"],
    ["returning", "Returning series"],
    ["new", "New & announced"],
  ];

  return (
    <div className="screen mq-page cal-page">
      <div className="cal-tabsbar">
        <div className="segmented" style={{ flexWrap: "wrap" }}>
          {tabs.map(([v, label]) => (
            <div key={v} className={`seg ${view === v ? "seg-active" : ""}`} onClick={() => setView(v)}>{label}</div>
          ))}
        </div>
      </div>

      {view === "shows" ? <MyShowsFeed /> : <PremieresList kind={view} />}
    </div>
  );
}

function MyShowsFeed() {
  const [weeksBack, setWeeksBack] = useState(3);
  const { data: rows = [], isPending } = useCalendarFeed(weeksBack);
  const now = useMemo(() => new Date(), []);

  const topRef = useRef<HTMLDivElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const prevH = useRef(0);
  const anchored = useRef(false);

  const { days, later } = useMemo(() => groupFeed(rows, now), [rows, now]);

  // lazy history: an observer near the top pulls in earlier weeks
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => {
        // Only auto-extend when the page actually scrolls — otherwise a short
        // feed keeps the sentinel visible and would loop straight to the cap.
        const scrollable = document.documentElement.scrollHeight > window.innerHeight + 200;
        if (ents[0].isIntersecting && scrollable && weeksBack < 60 && !isPending) {
          prevH.current = document.documentElement.scrollHeight;
          setWeeksBack((w) => w + 3);
        }
      },
      { rootMargin: "300px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [weeksBack, isPending]);

  // keep the viewport steady when earlier weeks are prepended
  useLayoutEffect(() => {
    if (prevH.current) {
      const delta = document.documentElement.scrollHeight - prevH.current;
      if (delta > 0) window.scrollBy(0, delta);
      prevH.current = 0;
    }
  }, [rows.length]);

  // land on "Today" once the first page is in
  useEffect(() => {
    if (anchored.current || isPending) return;
    anchored.current = true;
    const id = requestAnimationFrame(() => {
      todayRef.current?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -76);
    });
    return () => cancelAnimationFrame(id);
  }, [isPending]);

  if (!isPending && rows.length === 0) {
    return <p className="dim">No dated episodes from the shows you follow in this window.</p>;
  }

  const todayOffset = days.find(([off]) => off >= 0)?.[0];

  return (
    <div className="cal-feed">
      <div ref={topRef} className="cal-sentinel">
        {weeksBack < 60 ? "Loading earlier episodes…" : "That's the start of your history."}
      </div>

      {days.map(([off, list]) => (
        <div key={off} ref={off === todayOffset ? todayRef : undefined} className="cal-day">
          <div className="cal-daysep"><span>{dayLabel(off, list[0].air_datetime)}</span></div>
          {list.map((ep) => (
            <CalEpRow key={ep.episode_id} ep={ep} now={now} />
          ))}
        </div>
      ))}

      {later.length > 0 && (
        <div className="cal-day">
          <div className="cal-daysep"><span>Later</span></div>
          {later.map((ep) => (
            <CalEpRow key={ep.episode_id} ep={ep} now={now} later />
          ))}
        </div>
      )}
    </div>
  );
}

function CalEpRow({ ep, now, later = false }: { ep: FeedRow; now: Date; later?: boolean }) {
  const open = useOpenTitle();
  const mark = useMarkWatched(ep.title_id);
  const unmark = useUnmarkWatched(ep.title_id);
  const past = new Date(ep.air_datetime).getTime() < now.getTime();
  const days = dayOffset(ep.air_datetime, now);
  const tag = episodeBadge(ep);
  const seen = ep.watch_event_id != null;
  const art = tmdbImg(ep.poster_path, "w92");

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (seen) unmark.mutate(ep.watch_event_id!);
    else mark.mutate(ep.episode_id);
  };

  return (
    <div className="cal-ep" onClick={() => open(ep.tmdb_id)}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(ep.show_name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill">{ep.show_name}<ChevronRight size={12} /></span>
        <div className="cal-ep-se">
          S{pad2(ep.season_number)} · E{pad2(ep.episode_number)}
          {tag && <span className="badge badge-soft" style={{ marginLeft: 8 }}>{tag}</span>}
        </div>
        <div className="cal-ep-name mute">{ep.episode_name}</div>
      </div>
      <div className="cal-ep-right">
        {later ? (
          <>
            <div className="cal-days">{days}<span>days</span></div>
            <div className="cal-when mute">{fmtShort(ep.air_datetime)} · {fmtTime(ep.air_datetime)}</div>
          </>
        ) : past ? (
          <button className={`check ${seen ? "on" : ""}`} onClick={toggle} title={seen ? "Watched" : "Mark watched"}>
            <Check size={15} strokeWidth={3} />
          </button>
        ) : (
          <>
            <div className="cal-time">{fmtTime(ep.air_datetime)}</div>
            {ep.network && <NetworkLogo network={ep.network} />}
          </>
        )}
      </div>
    </div>
  );
}

function PremieresList({ kind }: { kind: "returning" | "new" }) {
  const { data: library = [] } = useLibrary();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  // Returning = the show aired before (a prior season exists); New = never aired.
  const items = library.filter(
    (s) =>
      s.status === "upcoming" &&
      (kind === "returning"
        ? s.first_air_date != null && s.first_air_date <= todayIso
        : s.first_air_date == null || s.first_air_date > todayIso),
  );

  const bucketOf = (s: LibraryShow): "month" | "later" | "tba" => {
    const at = premiereMs(s);
    if (at == null || at <= now.getTime()) return "tba";
    const d = new Date(at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() ? "month" : "later";
  };

  const monthLabel = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const groups: { key: "month" | "later" | "tba"; title: string; sub: string }[] = [
    { key: "month", title: "This month", sub: monthLabel },
    { key: "later", title: `Later`, sub: "Dated premieres" },
    { key: "tba", title: "Announced · no date yet", sub: "We'll tell you the moment it's dated" },
  ];

  if (items.length === 0) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        Nothing {kind === "returning" ? "returning" : "new"} from the shows you follow right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => {
        const rows = items.filter((s) => bucketOf(s) === g.key);
        if (!rows.length) return null;
        return (
          <div key={g.key} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="section-title">{g.title}</h2>
              <span className="mute" style={{ fontSize: 13 }}>{g.sub}</span>
            </div>
            <div className="flex flex-col gap-3">
              {rows.map((s) => (
                <UpcomingRow key={s.title_id} s={s} announced={g.key === "tba"} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UpcomingRow({ s, announced }: { s: LibraryShow; announced: boolean }) {
  const open = useOpenTitle();
  // Notify placeholder — persisted flag lands in P2-C10.
  const [notify, setNotify] = useState(s.notify);
  const at = premiereMs(s);
  const art = tmdbImg(s.poster_path, "w92");

  return (
    <div className="card mq-row" onClick={() => open(s.tmdb_id)}>
      <div className="mq-row-art tall" style={art ? undefined : { background: posterBg(s.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${announced ? "badge-soft" : "badge-accent"}`}>
            {announced ? "Announced" : at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "TBA"}
          </span>
          {s.network && <NetworkLogo network={s.network} />}
        </div>
        <div className="mq-row-title truncate" style={{ fontSize: 16 }}>{s.name}</div>
        <div className="dim truncate" style={{ fontSize: 13 }}>{s.genres.slice(0, 2).join(", ") || "—"}</div>
      </div>
      <button
        className={`btn btn-sm ${notify ? "btn-accent" : "btn-outline"}`}
        onClick={(e) => { e.stopPropagation(); setNotify((v) => !v); }}
      >
        <Bell size={15} />{notify ? "Tracking" : "Notify me"}
      </button>
    </div>
  );
}
