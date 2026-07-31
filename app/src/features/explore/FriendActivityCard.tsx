import { Fragment, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useFriendActivity, type ActivityItem } from "@/lib/explore";
import { useEventReactions } from "@/lib/reactions";
import { byEvent, type ReactionRow } from "@/domain/reactions";
import { relativeTime } from "@/domain/time";
import { tmdbImg } from "@/lib/tmdb";
import { dateLocale, locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { useAuth } from "@/features/auth/AuthProvider";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useShowMore } from "@/ui/ShowMore";
import { posterBg } from "@/ui/posterBg";
import { ReactionBar } from "@/features/explore/ReactionBar";

/* One shared empty list, so a row with no reactions doesn't hand ReactionBar a
   fresh array identity on every render. */
const EMPTY: ReactionRow[] = [];

/* The group's wall (P4-C4, reactions in 0058) — every episode watched, plus
   adds and ratings, yours among them.

   Same-day episodes of one show arrive already collapsed into a single row
   ("S1 · E3–E7"): 0058 moved that grouping into rpc_friend_activity, because a
   reaction needs a row identity that every reader agrees on, and grouping by
   each viewer's local day did not give one. A row from an older RPC has no
   event_key — it renders un-collapsed and without reactions rather than
   breaking. The started/finished_season branches only render against a
   pre-0040 RPC.

   Reactions travel by event_key alone: whose event it is and which show it is
   about are derived from that key in Postgres, never sent from here. */

function epRange(a: ActivityItem): React.ReactNode {
  const toS = a.to_season ?? a.season_number;
  const toE = a.to_episode ?? a.episode_number;
  if (toS === a.season_number && toE === a.episode_number)
    return <>S{a.season_number} · E{a.episode_number}</>;
  if (toS === a.season_number)
    return `S${a.season_number} · E${a.episode_number}–E${toE}`;
  return `S${a.season_number} · E${a.episode_number} – S${toS} · E${toE}`;
}

/* Slot React nodes into a translated sentence's {placeholders}. The whole
   sentence is one dictionary key, so a language can put the show name and the
   episode range where its grammar wants them ("vio S1 · E3 de Severance") —
   a chain of translated fragments would freeze English order. */
function fill(s: string, nodes: Record<string, React.ReactNode>): React.ReactNode {
  return s.split(/(\{[a-z]+\})/).map((part, i) => {
    const slot = /^\{[a-z]+\}$/.test(part) ? nodes[part.slice(1, -1)] : undefined;
    return <Fragment key={i}>{slot ?? part}</Fragment>;
  });
}

/* Your own rows need their own keys, not the third-person ones: English gets
   away with one verb ("watched"), Spanish does not ("vio" / "viste"). */
function phrase(a: ActivityItem, titleName: string, isMe: boolean): React.ReactNode {
  const name = <b style={{ fontWeight: 700 }}>{titleName}</b>;
  const eps = a.season_number != null && a.episode_number != null && (
    <b style={{ fontWeight: 700 }}>{epRange(a)}</b>
  );
  switch (a.verb) {
    case "rated":
      return fill(tr(isMe ? "self: rated {name}" : "rated {name}"), { name });
    case "added":
      return fill(
        tr(isMe ? "self: added {name} to their watchlist" : "added {name} to their watchlist"),
        { name },
      );
    case "watched":
      return fill(tr(isMe ? "self: watched {eps} of {name}" : "watched {eps} of {name}"), { eps, name });
    case "started":
      return fill(tr("started watching {name}"), { name });
    case "finished_season":
      // {season} is a plain number — filled first, so only {name} stays a node.
      return fill(tv("finished season {season} of {name}", { season: a.season_number ?? "" }), { name });
  }
}

export function FriendActivityCard({ enabled }: { enabled: boolean }) {
  // Per-episode events (0040) fill a feed much faster than the old digest
  // verbs did, so pull a deeper page.
  const { data: items = [] } = useFriendActivity(enabled, 60);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const esNames = useEsNames();
  const { session } = useAuth();
  const me = session?.user.id ?? "";
  // The shared opener, which also warms the detail cache — the inline copy this
  // replaced opened every activity row cold.
  const openTitle = useOpenTitle();

  // A reaction notification links straight at its row, which may sit anywhere
  // in the page — so search all of it, not just the first screenful, and reveal
  // down to the row. Slicing to 30 here used to make a link to row 31+ a
  // silent no-op even though the row had been fetched.
  const flashKey = searchParams.get("event");
  const flashAt = flashKey ? items.findIndex((r) => r.event_key === flashKey) : -1;
  const { shown, more } = useShowMore(items, 10, flashAt < 0 ? 0 : flashAt + 1);

  const flashRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flashKey) return;
    if (flashAt >= 0) flashRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Dropped even when the row was not found — otherwise a stale ?event= rides
    // along in the URL for the rest of the session and flashes a row the reader
    // already dealt with if it ever floats back up.
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("event");
        return next;
      }, { replace: true });
    }, 2600);
    return () => clearTimeout(timer);
    // setSearchParams is a fresh identity on every URL change, so it stays out
    // of the deps: with it, opening a show mid-flash restarted the timer and
    // yanked the feed back into view behind the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, flashAt]);

  const keys = useMemo(
    () => shown.map((r) => r.event_key).filter((k): k is string => Boolean(k)),
    [shown],
  );
  const { data: reactionRows = [] } = useEventReactions(keys);
  const reactions = useMemo(() => byEvent(reactionRows), [reactionRows]);

  if (!enabled || items.length === 0) return null;

  const openFriend = (id: string) => navigate(`/friend/${id}`);

  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{tr("Activity")}</h2>
        </div>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {shown.map((a) => {
          const art = tmdbImg(a.poster_path, "w92");
          const titleName = locName(esNames, a.tmdb_id, a.title_name);
          const isMe = a.friend_id === me;
          const flashed = Boolean(a.event_key) && a.event_key === flashKey;
          const count = a.ep_count ?? 1;
          return (
            <div
              key={a.event_key ?? `${a.friend_id}|${a.tmdb_id}|${a.at}`}
              ref={flashed ? flashRef : undefined}
              className={`fr-activity${flashed ? " fr-flash" : ""}`}
              onClick={() => openTitle(a.tmdb_id)}
            >
              <span onClick={(e) => { e.stopPropagation(); openFriend(a.friend_id); }} style={{ flex: "0 0 auto" }}>
                <FriendAvatar f={{ id: a.friend_id, name: a.friend_name, avatarUrl: a.friend_avatar }} size={38} />
              </span>
              <div className="flex-1 min-w-0">
                {/* Two lines, not one: the name and verb eat the whole line on a
                    phone, and truncating left the show itself as "Ana Ruiz rated B…" */}
                <div style={{ fontSize: 13.5 }} className="line-clamp-2">
                  <b style={{ fontWeight: 700 }}>{isMe ? tr("You") : a.friend_name}</b> {phrase(a, titleName, isMe)}
                </div>
                {/* Reactions share the timestamp's line rather than opening one
                    of their own: an unreacted row is the overwhelming case, and
                    a lone ⊕ on its own line taxes all 30 of them. */}
                <div className="fr-meta">
                  <span className="mute" style={{ fontSize: 11.5 }}>
                    {relativeTime(a.at, new Date(), dateLocale())}{count > 1 && <> · {count} {tr("episodes")}</>}
                  </span>
                  {a.event_key && (
                    <ReactionBar
                      eventKey={a.event_key}
                      rows={reactions.get(a.event_key) ?? EMPTY}
                      me={me}
                    />
                  )}
                </div>
              </div>
              {a.verb === "rated" && a.score != null && (
                <span className="badge badge-soft" style={{ fontWeight: 800 }}>{a.score}/10</span>
              )}
              <div className="mq-row-art" style={{ width: 34, height: 50, ...(art ? {} : { background: posterBg(titleName) }) }}>
                {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              </div>
            </div>
          );
        })}
      </div>
      {more}
    </section>
  );
}
