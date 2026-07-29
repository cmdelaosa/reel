import { Check, ChevronRight } from "lucide-react";
import { dayOffset, episodeBadge } from "@/domain/calendar";
import type { FeedRow } from "@/lib/calendar";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { locName, t as tr, useEsNames } from "@/lib/i18n";
import { airTimeZone, fmtAirDate, fmtAirTime, hasRealAirTime } from "@/lib/region";
import { WatchOn } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* One episode row in the calendar feed. Shared so Tonight's "Premieres soon"
   renders identical rows (always the `later` variant — a days-away countdown
   plus the dated time). `sub` renders it as a borderless child inside a
   CalEpGroup: a future child hides the date (the group header carries it),
   a past child keeps its own watched-check. */

const pad2 = (n: number) => String(n).padStart(2, "0");

export function CalEpRow({ ep, now, later = false, sub = false }: { ep: FeedRow; now: Date; later?: boolean; sub?: boolean }) {
  const open = useOpenTitle();
  const mark = useMarkWatched(ep.title_id);
  const unmark = useUnmarkWatched(ep.title_id);
  const past = new Date(ep.air_datetime).getTime() < now.getTime();
  const days = dayOffset(ep.air_datetime, now, airTimeZone());
  // Only shows TVmaze could date carry a real broadcast clock; the rest hold a
  // 21:00 UTC placeholder, so they get the date and an empty time slot rather
  // than an invented hour.
  const timed = hasRealAirTime(ep.air_time_source);
  const tag = episodeBadge(ep);
  const seen = ep.watch_event_id != null;
  const art = tmdbImg(ep.poster_path, "w92");
  const esNames = useEsNames();
  const showName = locName(esNames, ep.tmdb_id, ep.show_name);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (seen) unmark.mutate(ep.watch_event_id!);
    else mark.mutate(ep.episode_id);
  };

  return (
    <div className={sub ? "cal-ep cal-ep-sub" : "cal-ep"} onClick={() => open(ep.tmdb_id)}>
      <div className="cal-ep-art" style={art ? undefined : { background: posterBg(showName) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="cal-ep-main">
        <span className="cal-showpill"><span className="truncate">{showName}</span><ChevronRight size={12} style={{ flex: "0 0 auto" }} /></span>
        <div className="cal-ep-se">
          S{pad2(ep.season_number)} · E{pad2(ep.episode_number)}
          {tag && <span className="badge badge-soft" style={{ marginLeft: 8 }}>{tr(tag)}</span>}
        </div>
        <div className="cal-ep-name mute">{ep.episode_name}</div>
      </div>
      <div className="cal-ep-right">
        {sub && !past ? null : later ? (
          <>
            <div className="cal-days">{days}<span>{tr("days")}</span></div>
            <div className="cal-when mute">
              {fmtAirDate(ep.air_datetime)}{timed && ` · ${fmtAirTime(ep.air_datetime)}`}
            </div>
          </>
        ) : past ? (
          <button className={`check ${seen ? "on" : ""}`} onClick={toggle} title={seen ? tr("Watched") : tr("Mark watched")}>
            <Check size={15} strokeWidth={3} />
          </button>
        ) : (
          <>
            {timed && <div className="cal-time">{fmtAirTime(ep.air_datetime)}</div>}
            <WatchOn tmdbId={ep.tmdb_id} />
          </>
        )}
      </div>
    </div>
  );
}
