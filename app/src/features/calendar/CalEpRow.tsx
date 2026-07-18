import { Check, ChevronRight } from "lucide-react";
import { dayOffset, episodeBadge } from "@/domain/calendar";
import type { FeedRow } from "@/lib/calendar";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
import { NetworkLogo } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* One episode row in the calendar feed. Shared so Tonight's "Premieres soon"
   renders identical rows (always the `later` variant — a days-away countdown
   plus the dated time). `sub` renders it as a borderless child inside a
   CalEpGroup: a future child hides the date (the group header carries it),
   a past child keeps its own watched-check. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" });

export function CalEpRow({ ep, now, later = false, sub = false }: { ep: FeedRow; now: Date; later?: boolean; sub?: boolean }) {
  const open = useOpenTitle();
  const mark = useMarkWatched(ep.title_id);
  const unmark = useUnmarkWatched(ep.title_id);
  const past = new Date(ep.air_datetime).getTime() < now.getTime();
  const days = dayOffset(ep.air_datetime, now);
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
        <span className="cal-showpill">{showName}<ChevronRight size={12} /></span>
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
            <div className="cal-when mute">{fmtShort(ep.air_datetime)} · {fmtTime(ep.air_datetime)}</div>
          </>
        ) : past ? (
          <button className={`check ${seen ? "on" : ""}`} onClick={toggle} title={seen ? tr("Watched") : tr("Mark watched")}>
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
