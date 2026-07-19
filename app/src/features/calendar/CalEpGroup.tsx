import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { dayOffset, episodeBadge, type FeedCluster } from "@/domain/calendar";
import type { FeedRow } from "@/lib/calendar";
import { useMarkUpTo, useUnmarkWatched } from "@/lib/watch";
import { tmdbImg } from "@/lib/tmdb";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { dateLocale, isEs, locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { NetworkLogo } from "@/ui";
import { posterBg } from "@/ui/posterBg";
import { CalEpRow } from "@/features/calendar/CalEpRow";

/* A same-show, same-day batch collapsed into one card (TV Time style): the
   lead (lowest) episode heads it, a "N episodes" bar reveals the rest. Past
   batches carry a single bulk check that marks up to the LAST episode of the
   drop (reusing rpc_mark_up_to) — one tap to clear a binged season. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" });

export function CalEpGroup({
  cluster,
  now,
  later = false,
  onMarked,
}: {
  cluster: FeedCluster<FeedRow>;
  now: Date;
  later?: boolean;
  onMarked: (m: { titleId: string; ids: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const openTitle = useOpenTitle();
  const { lead, rest, last, count } = cluster;
  const markUpTo = useMarkUpTo(lead.title_id);
  const unmark = useUnmarkWatched(lead.title_id);

  const past = new Date(lead.air_datetime).getTime() < now.getTime();
  const days = dayOffset(lead.air_datetime, now);
  const tag = episodeBadge(lead);
  const art = tmdbImg(lead.poster_path, "w92");
  const esNames = useEsNames();
  const showName = locName(esNames, lead.tmdb_id, lead.show_name);

  const eps = [lead, ...rest];
  const seenCount = eps.reduce((n, e) => n + (e.watch_event_id != null ? 1 : 0), 0);
  const allSeen = seenCount === count;
  const someSeen = seenCount > 0;

  const bulk = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allSeen) {
      for (const ep of eps) if (ep.watch_event_id) unmark.mutate(ep.watch_event_id);
    } else {
      const ids = await markUpTo.mutateAsync(last.episode_id);
      onMarked({ titleId: lead.title_id, ids });
    }
  };

  return (
    <div className="cal-group">
      <div className="cal-ep cal-group-head" onClick={() => openTitle(lead.tmdb_id)}>
        <div className="cal-ep-art" style={art ? undefined : { background: posterBg(showName) }}>
          {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          <div className="poster-sheen" />
        </div>
        <div className="cal-ep-main">
          <span className="cal-showpill"><span className="truncate">{showName}</span><ChevronRight size={12} style={{ flex: "0 0 auto" }} /></span>
          <div className="cal-ep-se">
            S{pad2(lead.season_number)} · E{pad2(lead.episode_number)}
            {tag && <span className="badge badge-soft" style={{ marginLeft: 8 }}>{tr(tag)}</span>}
          </div>
          <div className="cal-ep-name mute">{lead.episode_name}</div>
        </div>
        <div className="cal-ep-right">
          {later ? (
            <>
              <div className="cal-days">{days}<span>{tr("days")}</span></div>
              <div className="cal-when mute">{fmtShort(lead.air_datetime)} · {fmtTime(lead.air_datetime)}</div>
            </>
          ) : past ? (
            <button
              className={`check ${allSeen ? "on" : someSeen ? "partial" : ""}`}
              onClick={bulk}
              title={allSeen ? tr("Watched — tap to clear") : tv("Mark all {count} watched", { count })}
              aria-label={allSeen ? tr("Watched — tap to clear") : tv("Mark all {count} watched", { count })}
            >
              <Check size={15} strokeWidth={3} />
            </button>
          ) : (
            <>
              <div className="cal-time">{fmtTime(lead.air_datetime)}</div>
              {lead.network && <NetworkLogo network={lead.network} />}
            </>
          )}
        </div>
      </div>

      <button
        className="cal-group-more"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-expanded={open}
      >
        <span>
          {count} {tr("episodes")}
          {past && someSeen && !allSeen ? ` · ${seenCount} ${isEs() ? "vistos" : "watched"}` : ""}
        </span>
        <ChevronDown size={16} className={open ? "cal-chev-open" : ""} />
      </button>

      {open && (
        <div className="cal-group-eps">
          {rest.map((ep) => (
            <CalEpRow key={ep.episode_id} ep={ep} now={now} later={later} sub />
          ))}
        </div>
      )}
    </div>
  );
}
