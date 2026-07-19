import { Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useFriendActivity, type ActivityItem } from "@/lib/explore";
import { relativeTime } from "@/domain/time";
import { tmdbImg } from "@/lib/tmdb";
import { dateLocale, locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useShowMore } from "@/ui/ShowMore";
import { posterBg } from "@/ui/posterBg";

/* Friend activity feed (P4-C4) — every episode watched, plus adds and ratings.
   Episodes of the same show watched by the same friend on the same (local) day
   collapse into one row with the episode range ("S1 · E3–E7").
   The started/finished_season branches only render against a pre-0040 RPC. */

type FeedRow = { a: ActivityItem; from: ActivityItem; to: ActivityItem; count: number };

function epOrder(a: ActivityItem, b: ActivityItem) {
  return (a.season_number! - b.season_number!) || (a.episode_number! - b.episode_number!);
}

function groupWatched(items: ActivityItem[]): FeedRow[] {
  const out: FeedRow[] = [];
  const groups = new Map<string, FeedRow>();
  for (const a of items) {
    const row: FeedRow = { a, from: a, to: a, count: 1 };
    if (a.verb !== "watched" || a.season_number == null || a.episode_number == null) {
      out.push(row);
      continue;
    }
    const d = new Date(a.at);
    const key = `${a.friend_id}|${a.tmdb_id}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, row);
      out.push(row); // the group sits where its newest event does (items are desc)
    } else {
      g.count++;
      if (epOrder(a, g.from) < 0) g.from = a;
      if (epOrder(a, g.to) > 0) g.to = a;
    }
  }
  return out;
}

function epRange({ from, to }: FeedRow): string {
  if (from.season_number === to.season_number)
    return `S${from.season_number} · E${from.episode_number}–E${to.episode_number}`;
  return `S${from.season_number} · E${from.episode_number} – S${to.season_number} · E${to.episode_number}`;
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

function phrase(r: FeedRow, titleName: string): React.ReactNode {
  const a = r.a;
  const name = <b style={{ fontWeight: 700 }}>{titleName}</b>;
  const eps = a.season_number != null && a.episode_number != null && (
    <b style={{ fontWeight: 700 }}>
      {r.count > 1 ? epRange(r) : <>S{a.season_number} · E{a.episode_number}</>}
    </b>
  );
  switch (a.verb) {
    case "rated": return fill(tr("rated {name}"), { name });
    case "added": return fill(tr("added {name} to their watchlist"), { name });
    case "watched": return fill(tr("watched {eps} of {name}"), { eps, name });
    case "started": return fill(tr("started watching {name}"), { name });
    case "finished_season":
      // {season} is a plain number — filled first, so only {name} stays a node.
      return fill(tv("finished season {season} of {name}", { season: a.season_number ?? "" }), { name });
  }
}

export function FriendActivityCard({ enabled }: { enabled: boolean }) {
  // Per-episode events (0040) fill a feed much faster than the old digest
  // verbs did, so pull a deeper page.
  const { data: items = [] } = useFriendActivity(enabled, 60);
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const esNames = useEsNames();

  // 10 events revealed at a time, up to 30.
  const rows = groupWatched(items).slice(0, 30);
  const { shown, more } = useShowMore(rows, 10);

  if (!enabled || items.length === 0) return null;

  const openTitle = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });
  const openFriend = (id: string) => navigate(`/friend/${id}`);

  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{tr("Friend activity")}</h2>
        </div>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {shown.map((r) => {
          const a = r.a;
          const art = tmdbImg(a.poster_path, "w92");
          const titleName = locName(esNames, a.tmdb_id, a.title_name);
          return (
            <div key={`${a.friend_id}|${a.tmdb_id}|${a.at}`} className="fr-activity" onClick={() => openTitle(a.tmdb_id)}>
              <span onClick={(e) => { e.stopPropagation(); openFriend(a.friend_id); }} style={{ flex: "0 0 auto" }}>
                <FriendAvatar f={{ id: a.friend_id, name: a.friend_name, avatarUrl: a.friend_avatar }} size={38} />
              </span>
              <div className="flex-1 min-w-0">
                {/* Two lines, not one: the name and verb eat the whole line on a
                    phone, and truncating left the show itself as "Ana Ruiz rated B…" */}
                <div style={{ fontSize: 13.5 }} className="line-clamp-2">
                  <b style={{ fontWeight: 700 }}>{a.friend_name}</b> {phrase(r, titleName)}
                </div>
                <div className="mute" style={{ fontSize: 11.5 }}>
                  {relativeTime(a.at, new Date(), dateLocale())}{r.count > 1 && <> · {r.count} {tr("episodes")}</>}
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
