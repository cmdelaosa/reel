import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { clusterFeed, dayLabel, groupFeed, type FeedCluster } from "@/domain/calendar";
import { premiereMs } from "@/domain/tonight";
import { useCalendarFeed, type FeedRow } from "@/lib/calendar";
import { useLibrary, useToggleNotify, type LibraryShow } from "@/lib/library";
import { useUndoMarks } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, TabMenu } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { CalEpRow } from "@/features/calendar/CalEpRow";
import { CalEpGroup } from "@/features/calendar/CalEpGroup";

/* Calendar — chronological my-shows feed with lazy history, plus returning /
   new views. Port of prototype marquee.tsx CalendarTab/MyShowsFeed/CalEpRow/
   PremieresList, including the IntersectionObserver + useLayoutEffect
   scroll-preservation approach. */

export default function CalendarPage() {
  const [view, setView] = useState<"shows" | "returning" | "new">("shows");
  const tabs: { key: typeof view; label: string }[] = [
    { key: "shows", label: tr("My shows") },
    { key: "returning", label: tr("Returning series") },
    { key: "new", label: tr("New & announced") },
  ];

  return (
    <div className="screen mq-page cal-page">
      <div className="cal-tabsbar">
        <div className="segmented scroll no-scrollbar">
          {tabs.map((t) => (
            <div key={t.key} className={`seg ${view === t.key ? "seg-active" : ""}`} onClick={() => setView(t.key)}>{t.label}</div>
          ))}
        </div>
        {/* Phone shape of the same strip: "Nuevas y anunciadas" ran off the edge
            of a 360px viewport with 84 of its 162px on screen. `floating` makes
            the trigger the blurred pill itself, since this bar has no layout of
            its own to sit in — it hovers over the feed. */}
        <TabMenu value={view} options={tabs} onPick={setView} menuLabel={tr("Calendar")} align="center" floating />
      </div>

      {view === "shows" ? <MyShowsFeed /> : <PremieresList kind={view} />}
    </div>
  );
}

function MyShowsFeed() {
  const [weeksBack, setWeeksBack] = useState(3);
  const { data: rows = [], isPending, isPlaceholderData } = useCalendarFeed(weeksBack);
  const now = useMemo(() => new Date(), []);

  const topRef = useRef<HTMLDivElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const prevH = useRef(0);
  const anchored = useRef(false);

  // Undo toast for the bulk "mark up to here" on a collapsed past batch.
  const [toast, setToast] = useState<{ titleId: string; ids: string[]; count: number } | null>(null);
  const undoMarks = useUndoMarks(toast?.titleId ?? "");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const { days, later } = useMemo(() => groupFeed(rows, now), [rows, now]);

  const renderCluster = (c: FeedCluster<FeedRow>, isLater: boolean) =>
    c.count === 1 ? (
      <CalEpRow key={c.lead.episode_id} ep={c.lead} now={now} later={isLater} />
    ) : (
      <CalEpGroup
        key={`${c.lead.title_id}-${c.lead.episode_id}`}
        cluster={c}
        now={now}
        later={isLater}
        onMarked={({ titleId, ids }) => setToast({ titleId, ids, count: ids.length })}
      />
    );

  // lazy history: an observer near the top pulls in earlier weeks
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => {
        // Only auto-extend when the page actually scrolls — otherwise a short
        // feed keeps the sentinel visible and would loop straight to the cap.
        // And never before the initial today-anchor has landed: on a remount
        // with warm cache the feed mounts at scroll 0 with the sentinel in
        // view, and a widen racing the anchor prepends content that shifts
        // the viewport weeks off target.
        const scrollable = document.documentElement.scrollHeight > window.innerHeight + 200;
        if (ents[0].isIntersecting && anchored.current && scrollable && weeksBack < 60 && !isPending) {
          prevH.current = document.documentElement.scrollHeight;
          setWeeksBack((w) => w + 3);
        }
      },
      { rootMargin: "300px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [weeksBack, isPending]);

  // keep the viewport steady when earlier weeks are prepended. Key on the rows
  // *reference* (not its length): keepPreviousData holds the old array during a
  // widen and hands back a fresh array on settle, so this runs — and clears the
  // anchor — on every settle, even when the widened range yields no new rows.
  useLayoutEffect(() => {
    if (prevH.current) {
      const delta = document.documentElement.scrollHeight - prevH.current;
      if (delta > 0) window.scrollBy(0, delta);
      prevH.current = 0;
    }
  }, [rows]);

  // land on "Today" once the first page is in
  const hasAired = days.some(([off]) => off <= 0);
  useEffect(() => {
    if (anchored.current || isPending || isPlaceholderData) return;
    // If the initial window came back all-future (nothing aired in the last
    // `weeksBack` weeks — common mid-hiatus), widen until the last aired day
    // is actually loaded; anchoring now would throw the user at the next
    // premiere, possibly weeks away.
    if (!hasAired && rows.length > 0 && weeksBack < 60) {
      // Not a render cascade: each widen changes the query key, so the loop
      // advances only as fetches settle, and the cap bounds it (see aceeae0).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeeksBack((w) => Math.min(60, w + 12));
      return;
    }
    // setTimeout, not rAF: frames don't run while the tab is hidden, so an
    // rAF-gated anchor silently never lands when the calendar is restored in a
    // background tab. Latch only after the scroll actually happened, so a
    // cancelled callback doesn't swallow the anchor for good.
    const id = setTimeout(() => {
      if (!todayRef.current) return;
      todayRef.current.scrollIntoView({ block: "start" });
      window.scrollBy(0, -76);
      anchored.current = true;
    }, 0);
    return () => clearTimeout(id);
  }, [isPending, isPlaceholderData, hasAired, rows.length, weeksBack]);

  if (!isPending && rows.length === 0) {
    return (
      <p className="dim">
        {tr("No dated episodes from the shows you follow in this window.")}
      </p>
    );
  }

  // Anchor on today when it has episodes; otherwise on the last day that does,
  // so you land at the edge of what has already aired rather than being thrown
  // forward to the next premiere (which can be weeks away).
  const todayOffset =
    days.find(([off]) => off === 0)?.[0] ??
    [...days].reverse().find(([off]) => off < 0)?.[0] ??
    days.find(([off]) => off > 0)?.[0];

  return (
    <>
      <div className="cal-feed">
        <div ref={topRef} className="cal-sentinel">
          {weeksBack < 60
            ? tr("Loading earlier episodes…")
            : tr("That's the start of your history.")}
        </div>

        {days.map(([off, list]) => (
          <div key={off} ref={off === todayOffset ? todayRef : undefined} className="cal-day">
            <div className="cal-daysep"><span>{dayLabel(off, list[0].air_datetime, dateLocale())}</span></div>
            {clusterFeed(list, now).map((c) => renderCluster(c, false))}
          </div>
        ))}

        {later.length > 0 && (
          <div className="cal-day">
            <div className="cal-daysep"><span>{tr("Later")}</span></div>
            {clusterFeed(later, now).map((c) => renderCluster(c, true))}
          </div>
        )}
      </div>

      {toast && (
        <div
          className="card sheet fixed flex items-center gap-3"
          style={{ zIndex: 85, left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "12px 16px", borderRadius: 999 }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 650 }}>
            {tv(toast.count === 1 ? "Marked {count} episode as seen" : "Marked {count} episodes as seen", { count: toast.count })}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => { undoMarks.mutate(toast.ids); setToast(null); }}>
            {tr("Undo")}
          </button>
        </div>
      )}
    </>
  );
}

function PremieresList({ kind }: { kind: "returning" | "new" }) {
  const { data: library = [] } = useLibrary();
  const now = new Date();

  // Land at the top whenever this view opens. The feed we came from leaves the
  // window scrolled deep into its history, and a plain scrollTo in the tab's
  // click handler can be undone by the feed's own scroll anchoring as it
  // unmounts — so re-assert it after the browser has laid this list out.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const id = setTimeout(() => window.scrollTo(0, 0), 0);
    return () => clearTimeout(id);
  }, [kind]);

  // New = never aired (aired_count 0). Returning = the show finished a season
  // and a NEW season is announced beyond it (upcoming_season_*, authoritative
  // from TMDB — a show mid-season is excluded until its current season wraps).
  // Stopped shows drop out of both.
  const items = library.filter(
    (s) =>
      !s.stopped &&
      (kind === "new" ? s.status === "upcoming" : s.upcoming_season_number != null),
  );

  // Premiere instant for bucketing. Returning prefers the dated next episode,
  // then the announced season's (often null) air_date; New uses premiereMs
  // (next episode, else the show's first_air_date).
  const premiereAt = (s: LibraryShow): number | null => {
    if (kind === "new") return premiereMs(s);
    if (s.next_air_datetime) return new Date(s.next_air_datetime).getTime();
    if (s.upcoming_season_air_date) return new Date(`${s.upcoming_season_air_date}T21:00:00Z`).getTime();
    return null;
  };

  const bucketOf = (s: LibraryShow): "month" | "later" | "tba" => {
    const at = premiereAt(s);
    if (at == null || at <= now.getTime()) return "tba";
    const d = new Date(at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() ? "month" : "later";
  };

  const groups: { key: "month" | "later" | "tba"; title: string }[] = [
    { key: "month", title: tr("This month") },
    { key: "later", title: tr("Later") },
    { key: "tba", title: tr("Announced · no date yet") },
  ];

  if (items.length === 0) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        {tr(kind === "returning"
          ? "Nothing returning from the shows you follow right now."
          : "Nothing new from the shows you follow right now.")}
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
            </div>
            <div className="flex flex-col gap-3">
              {rows.map((s) => (
                <UpcomingRow key={s.title_id} s={s} at={premiereAt(s)} announced={g.key === "tba"} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UpcomingRow({ s, at, announced }: { s: LibraryShow; at: number | null; announced: boolean }) {
  const open = useOpenTitle();
  const toggleNotify = useToggleNotify();
  const notify = s.notify; // persisted flag (optimistic via the library cache)
  const art = tmdbImg(s.poster_path, "w92");
  const esNames = useEsNames();
  const name = locName(esNames, s.tmdb_id, s.name);

  return (
    <div className="card mq-row" onClick={() => open(s.tmdb_id)}>
      <div className="mq-row-art tall" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${announced ? "badge-soft" : "badge-accent"}`}>
            {announced ? tr("Announced") : at ? new Date(at).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" }) : tr("TBA")}
          </span>
          {s.network && <NetworkLogo network={s.network} />}
        </div>
        <div className="mq-row-title truncate" style={{ fontSize: 16 }}>{name}</div>
        {s.upcoming_season_number != null ? (
          <div className="truncate" style={{ fontSize: 13, fontWeight: 650 }}>
            {tr("Season")} {s.upcoming_season_number}
          </div>
        ) : (
          <div className="dim truncate" style={{ fontSize: 13 }}>{s.genres.slice(0, 2).map(tGenre).join(", ") || "—"}</div>
        )}
      </div>
      <button
        className={`btn btn-sm ${notify ? "btn-accent" : "btn-outline"}`}
        onClick={(e) => { e.stopPropagation(); toggleNotify.mutate({ titleId: s.title_id, notify: !notify }); }}
      >
        <Bell size={15} />{notify ? tr("Tracking") : tr("Notify me")}
      </button>
    </div>
  );
}
