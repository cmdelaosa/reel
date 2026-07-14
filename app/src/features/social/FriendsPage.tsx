import { Star } from "lucide-react";
import { useFriendships } from "@/lib/friends";
import { useBestRatedByFriends, type BestRatedByFriends } from "@/lib/explore";
import { useIgnored } from "@/lib/ignore";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo } from "@/ui";
import { FriendStack } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";
import { FriendActivityCard } from "@/features/explore/FriendActivityCard";
import { FriendsSection } from "@/features/social/FriendsSection";
import { InvitesCard } from "@/features/you/InvitesCard";
import { useOpenTitle, useTitleIntent } from "@/lib/useOpenTitle";

/* Friends — the social hub (top-nav tab). Your friends list + requests, the
   activity feed (moved here from Explore), what they rate highest, and invites.
   Everything friend-powered lights up from the first accepted friend. */

export default function FriendsPage() {
  const { data: friendships = [] } = useFriendships();
  const hasFriends = friendships.some((f) => f.status === "accepted");

  const { isIgnored } = useIgnored();
  const { data: bestRatedRaw = [] } = useBestRatedByFriends(hasFriends);
  const bestRated = bestRatedRaw.filter((b) => !isIgnored(b.tmdb_id));
  const open = useOpenTitle();

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Friends</h1>
        <p className="dim mq-sub">Who you watch with — their activity, their favorites.</p>
      </header>

      <FriendsSection />

      <FriendActivityCard enabled={hasFriends} />

      {hasFriends && bestRated.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <div>
              <h2 className="section-title">Best rated by friends</h2>
              <p className="mute" style={{ fontSize: 13 }}>Their highest-scored shows</p>
            </div>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {bestRated.map((b) => (
              <BestRatedRow key={b.tmdb_id} b={b} onOpen={() => open(b.tmdb_id)} />
            ))}
          </div>
        </section>
      )}

      <InvitesCard />
    </div>
  );
}

function BestRatedRow({ b, onOpen }: { b: BestRatedByFriends; onOpen: () => void }) {
  const art = tmdbImg(b.poster_path, "w92");
  const intent = useTitleIntent(b.tmdb_id);
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(b.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{b.name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={b.raters.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url }))} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>{b.count} {b.count === 1 ? "friend" : "friends"}</span>
        </div>
      </div>
      {b.network && <NetworkLogo network={b.network} size={11} />}
      <span className="mq-score" style={{ fontSize: 17 }}>
        <Star size={13} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)", verticalAlign: "-1px" }} /> {b.avg_score.toFixed(1)}
      </span>
    </div>
  );
}
