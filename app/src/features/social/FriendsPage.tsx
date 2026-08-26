import { BarChart3, ChevronRight, Heart } from "lucide-react";
import { useNavigate } from "react-router";
import { useFriendships } from "@/lib/friends";
import { useTaste } from "@/lib/taste";
import { FriendActivityCard } from "@/features/explore/FriendActivityCard";
import { FriendsSection } from "@/features/social/FriendsSection";
import { InvitesCard } from "@/features/you/InvitesCard";
import { t as tr } from "@/lib/i18n";

/* Friends — the social hub (top-nav tab). Your friends list + requests, the
   activity feed (moved here from Explore), and invites. Ranking what they rate
   highest lives on /friends/stats, which filters to shows you haven't started.
   Everything friend-powered lights up from the first accepted friend. */

export default function FriendsPage() {
  const { data: friendships = [], isLoading } = useFriendships();
  const hasFriends = friendships.some((f) => f.status === "accepted");

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Friends")}</h1>

      {/* The teasers hold their row while friendships loads — they sit above
          everything else on the page, so appearing late shoved the whole thing
          down a beat after it painted. */}
      {(isLoading || hasFriends) && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))" }}>
          {isLoading ? (
            <>
              <div className="skeleton" style={{ height: 64 }} />
              <div className="skeleton" style={{ height: 64 }} />
            </>
          ) : (
            <>
              <TasteCard />
              <StatsCard />
            </>
          )}
        </div>
      )}

      <FriendsSection />

      <FriendActivityCard />

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

