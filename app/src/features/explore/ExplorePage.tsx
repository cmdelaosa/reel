import { Search, Star } from "lucide-react";
import { useFriendships } from "@/lib/friends";
import { useBestRatedByFriends, type BestRatedByFriends } from "@/lib/explore";
import { useIgnored } from "@/lib/ignore";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo } from "@/ui";
import { FriendStack } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";
import { FriendActivityCard } from "@/features/explore/FriendActivityCard";
import { DiscoverSections } from "@/features/explore/DiscoverSections";
import { CollectionsSection } from "@/features/explore/CollectionsSection";
import { useOpenTitle, useTitleIntent } from "@/lib/useOpenTitle";

/* Explore — trending + a tabbed discover section (Popular now / Top rated /
   With friends), collections, and the friend sections. Friend-powered surfaces
   appear once you have at least one accepted friend. */

export default function ExplorePage() {
  const { data: friendships = [] } = useFriendships();
  const friendCount = friendships.filter((f) => f.status === "accepted").length;
  const hasFriends = friendCount >= 1;

  const { isIgnored } = useIgnored();
  const { data: bestRatedRaw = [] } = useBestRatedByFriends(hasFriends);
  const bestRated = bestRatedRaw.filter((b) => !isIgnored(b.tmdb_id));
  const open = useOpenTitle();

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Explore</h1>
        <p className="dim mq-sub">Find your next show — starting with what your friends love.</p>
      </header>

      <button className="card mq-searchrow" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
        <Search size={18} className="mute" />
        <span className="mute">Search shows, genres, networks…</span>
        <kbd className="mq-kbd" style={{ marginLeft: "auto" }}>⌘K</kbd>
      </button>

      <DiscoverSections />

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

      <CollectionsSection />

      <FriendActivityCard enabled={hasFriends} />
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
