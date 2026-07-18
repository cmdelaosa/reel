import { BarChart3, ChevronRight, Heart, Star } from "lucide-react";
import { useNavigate } from "react-router";
import { useFriendships } from "@/lib/friends";
import { useTaste } from "@/lib/taste";
import { useBestRatedByFriends, type BestRatedByFriends } from "@/lib/explore";
import { useIgnored } from "@/lib/ignore";
import { tmdbImg } from "@/lib/tmdb";
import { NetworkLogo, usePager } from "@/ui";
import { FriendStack } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";
import { FriendActivityCard } from "@/features/explore/FriendActivityCard";
import { FriendsSection } from "@/features/social/FriendsSection";
import { InvitesCard } from "@/features/you/InvitesCard";
import { useOpenTitle, useTitleIntent } from "@/lib/useOpenTitle";
import { locName, t as tr, useEsNames } from "@/lib/i18n";

/* Friends — the social hub (top-nav tab). Your friends list + requests, the
   activity feed (moved here from Explore), what they rate highest, and invites.
   Everything friend-powered lights up from the first accepted friend. */

export default function FriendsPage() {
  const { data: friendships = [] } = useFriendships();
  const hasFriends = friendships.some((f) => f.status === "accepted");

  const { isIgnored } = useIgnored();
  const { data: bestRatedRaw = [] } = useBestRatedByFriends(hasFriends);
  const bestRated = bestRatedRaw.filter((b) => !isIgnored(b.tmdb_id));
  const { shown: bestShown, pager: bestPager } = usePager(bestRated, 12);
  const open = useOpenTitle();

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Friends")}</h1>

      {hasFriends && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <TasteCard />
          <StatsCard />
        </div>
      )}

      <FriendsSection />

      <FriendActivityCard enabled={hasFriends} />

      {hasFriends && bestRated.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <h2 className="section-title">{tr("Best rated by friends")}</h2>
            {bestPager}
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {bestShown.map((b) => (
              <BestRatedRow key={b.tmdb_id} b={b} onOpen={() => open(b.tmdb_id)} />
            ))}
          </div>
        </section>
      )}

      <InvitesCard />
    </div>
  );
}

/* Teaser for the aggregate taste comparison — leads with your closest match
   so the card is useful before you even open /friends/taste. */
function TasteCard() {
  const taste = useTaste();
  const navigate = useNavigate();
  const best = taste.ranked[0];
  return (
    <div className="card mq-row" onClick={() => navigate("/friends/taste")}>
      <span className="badge badge-soft btn-icon" style={{ width: 40, height: 40, flex: "0 0 auto" }}>
        <Heart size={18} style={{ color: "var(--accent)" }} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{tr("Taste match")}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {best
            ? <>{tr("Closest match:")} <b style={{ fontWeight: 650 }}>{best.name}</b> · {best.affinity!.pct}%</>
            : tr("See how your ratings line up with your friends'")}
        </div>
      </div>
      <ChevronRight size={16} className="mute" />
    </div>
  );
}

/* Teaser for the group scoreboard at /friends/stats. */
function StatsCard() {
  const navigate = useNavigate();
  return (
    <div className="card mq-row" onClick={() => navigate("/friends/stats")}>
      <span className="badge badge-soft btn-icon" style={{ width: 40, height: 40, flex: "0 0 auto" }}>
        <BarChart3 size={18} style={{ color: "var(--accent)" }} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{tr("Friends stats")}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {tr("What to watch next, score comparisons, shared stinkers")}
        </div>
      </div>
      <ChevronRight size={16} className="mute" />
    </div>
  );
}

function BestRatedRow({ b, onOpen }: { b: BestRatedByFriends; onOpen: () => void }) {
  const art = tmdbImg(b.poster_path, "w92");
  const intent = useTitleIntent(b.tmdb_id);
  const esNames = useEsNames();
  const name = locName(esNames, b.tmdb_id, b.name);
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={b.raters.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url }))} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>{b.count} {b.count === 1 ? tr("friend") : tr("friends")}</span>
        </div>
      </div>
      {b.network && <NetworkLogo network={b.network} size={11} />}
      <span className="mq-score" style={{ fontSize: 17 }}>
        <Star size={13} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)", verticalAlign: "-1px" }} /> {b.avg_score.toFixed(1)}
      </span>
    </div>
  );
}
