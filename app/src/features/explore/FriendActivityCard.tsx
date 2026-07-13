import { useNavigate, useSearchParams } from "react-router";
import { useFriendActivity, type ActivityItem } from "@/lib/explore";
import { relativeTime } from "@/domain/time";
import { tmdbImg } from "@/lib/tmdb";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";

/* Friend activity feed (P4-C4) — rated / added / started / finished a season. */

function phrase(a: ActivityItem): React.ReactNode {
  switch (a.verb) {
    case "rated": return <>rated <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
    case "added": return <>added <b style={{ fontWeight: 700 }}>{a.title_name}</b> to their watchlist</>;
    case "started": return <>started watching <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
    case "finished_season": return <>finished season {a.season_number} of <b style={{ fontWeight: 700 }}>{a.title_name}</b></>;
  }
}

export function FriendActivityCard({ enabled }: { enabled: boolean }) {
  const { data: items = [] } = useFriendActivity(enabled);
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
        {items.map((a, i) => {
          const art = tmdbImg(a.poster_path, "w92");
          return (
            <div key={i} className="fr-activity" onClick={() => openTitle(a.tmdb_id)}>
              <span onClick={(e) => { e.stopPropagation(); openFriend(a.friend_id); }} style={{ flex: "0 0 auto" }}>
                <FriendAvatar f={{ id: a.friend_id, name: a.friend_name, avatarUrl: a.friend_avatar }} size={38} />
              </span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13.5 }} className="truncate">
                  <b style={{ fontWeight: 700 }}>{a.friend_name}</b> {phrase(a)}
                </div>
                <div className="mute" style={{ fontSize: 11.5 }}>{relativeTime(a.at)}</div>
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
