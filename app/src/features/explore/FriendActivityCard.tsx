import { useNavigate, useSearchParams } from "react-router";
import { useFriendActivity, type ActivityItem } from "@/lib/explore";
import { relativeTime } from "@/domain/time";
import { tmdbImg } from "@/lib/tmdb";
import { FriendAvatar } from "@/ui/FriendAvatar";
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

function phrase(r: FeedRow): React.ReactNode {
  const a = r.a;
  switch (a.verb) {
    case "rated": return <>rated <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
    case "added": return <>added <b style={{ fontWeight: 700 }}>{a.title_name}</b> to their watchlist</>;
    case "watched":
      return (
        <>
          watched{" "}
          {a.season_number != null && a.episode_number != null && (
            <b style={{ fontWeight: 700 }}>
              {r.count > 1 ? epRange(r) : <>S{a.season_number} · E{a.episode_number}</>}
            </b>
          )}{" "}
          of <b style={{ fontWeight: 700 }}>{a.title_name}</b>
        </>
      );
    case "started": return <>started watching <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
    case "finished_season": return <>finished season {a.season_number} of <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
  }
}

export function FriendActivityCard({ enabled }: { enabled: boolean }) {
  // Per-episode events (0040) fill a feed much faster than the old digest
  // verbs did, so pull a deeper page.
  const { data: items = [] } = useFriendActivity(enabled, 60);
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

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
          <h2 className="section-title">Friend activity</h2>
          <p className="mute" style={{ fontSize: 13 }}>What your friends are watching and rating</p>
        </div>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {groupWatched(items).map((r, i) => {
          const a = r.a;
          const art = tmdbImg(a.poster_path, "w92");
          return (
            <div key={i} className="fr-activity" onClick={() => openTitle(a.tmdb_id)}>
              <span onClick={(e) => { e.stopPropagation(); openFriend(a.friend_id); }} style={{ flex: "0 0 auto" }}>
                <FriendAvatar f={{ id: a.friend_id, name: a.friend_name, avatarUrl: a.friend_avatar }} size={38} />
              </span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13.5 }} className="truncate">
                  <b style={{ fontWeight: 700 }}>{a.friend_name}</b> {phrase(r)}
                </div>
                <div className="mute" style={{ fontSize: 11.5 }}>
                  {relativeTime(a.at)}{r.count > 1 && <> · {r.count} episodes</>}
                </div>
              </div>
              {a.verb === "rated" && a.score != null && (
                <span className="badge badge-soft" style={{ fontWeight: 800 }}>{a.score}/10</span>
              )}
              <div className="mq-row-art" style={{ width: 34, height: 50, ...(art ? {} : { background: posterBg(a.title_name) }) }}>
                {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
