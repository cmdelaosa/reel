import { useMemo } from "react";
import { Award, Star, ThumbsDown, TrendingUp } from "lucide-react";
import { useLibrary } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings, type FriendRatingRow } from "@/lib/taste";
import { useIgnored } from "@/lib/ignore";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { locName, t as tr, useEsNames } from "@/lib/i18n";
import { tmdbImg } from "@/lib/tmdb";
import { FriendStack, type FriendLike } from "@/ui/FriendAvatar";
import { useShowMore } from "@/ui/ShowMore";
import { posterBg } from "@/ui/posterBg";

/* Group stats (route /friends/stats) — the friend-group scoreboard Krauser asked
   for: what to watch next (unseen, loved by friends), the full you-vs-friends
   score comparison, and the stinkers the group sat through anyway. All three
   derive from the same one-round-trip friends-ratings query as /friends/taste. */

interface StatTitle {
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  raters: FriendLike[];
  friendAvg: number;
  mine: number | null;
}

function useStats() {
  const { data: friendships = [], isPending: friendsPending } = useFriendships();
  const friends = useMemo(() => friendships.filter((f) => f.status === "accepted"), [friendships]);
  const friendIds = useMemo(() => friends.map((f) => f.other_id), [friends]);
  const { data: friendRatings = [], isPending: ratingsPending } = useFriendsRatings(friendIds);
  const { data: myRatings = [] } = useMyRatings();
  const { data: library = [] } = useLibrary();
  const { isIgnored } = useIgnored();

  return useMemo(() => {
    const friendMeta = new Map(friends.map((f) => [f.other_id, { id: f.other_id, name: f.display_name, avatarUrl: f.avatar_url }]));
    const myScore = new Map(myRatings.map((r) => [r.titles.tmdb_id, r.score]));
    const inLibrary = new Set(library.map((s) => s.tmdb_id));

    const byTitle = new Map<number, { meta: Omit<FriendRatingRow, "user_id" | "score">; scores: { who: FriendLike; score: number }[] }>();
    for (const r of friendRatings) {
      const who = friendMeta.get(r.user_id);
      if (!who) continue;
      let t = byTitle.get(r.tmdb_id);
      if (!t) byTitle.set(r.tmdb_id, (t = { meta: r, scores: [] }));
      t.scores.push({ who, score: r.score });
    }

    const all: StatTitle[] = [...byTitle.entries()].map(([tmdb_id, t]) => ({
      tmdb_id,
      name: t.meta.name,
      poster_path: t.meta.poster_path,
      raters: t.scores.map((s) => s.who),
      friendAvg: t.scores.reduce((sum, s) => sum + s.score, 0) / t.scores.length,
      mine: myScore.get(tmdb_id) ?? null,
    }));

    // (a) Unseen by you, recommended by friends: not in your library, best
    // friend average first (rater count breaks ties).
    const recommended = all
      .filter((t) => !inLibrary.has(t.tmdb_id) && t.mine == null && !isIgnored(t.tmdb_id))
      .sort((a, b) => b.friendAvg - a.friendAvg || b.raters.length - a.raters.length);

    // (b) Head-to-head: every show you and at least one friend both rated.
    const compared = all
      .filter((t) => t.mine != null)
      .sort((a, b) => b.friendAvg + (b.mine ?? 0) - (a.friendAvg + (a.mine ?? 0)));

    // (c) The stinkers: watched by several of you (2+ scores counting yours),
    // worst combined average first.
    const worst = all
      .filter((t) => t.raters.length + (t.mine != null ? 1 : 0) >= 2)
      .map((t) => ({
        ...t,
        groupAvg:
          (t.friendAvg * t.raters.length + (t.mine ?? 0)) /
          (t.raters.length + (t.mine != null ? 1 : 0)),
      }))
      .sort((a, b) => a.groupAvg - b.groupAvg);

    return {
      loading: friendsPending || (friendIds.length > 0 && ratingsPending),
      hasFriends: friends.length > 0,
      recommended,
      compared,
      worst,
    };
  }, [friends, friendIds, friendRatings, myRatings, library, isIgnored, friendsPending, ratingsPending]);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function StatRow({ t, groupAvg, onOpen }: { t: StatTitle; groupAvg?: number; onOpen: () => void }) {
  const art = tmdbImg(t.poster_path, "w92");
  const esNames = useEsNames();
  const name = locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={t.raters} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>
            {t.raters.length === 1 ? `1 ${tr("friend rated it")}` : `${t.raters.length} ${tr("friends rated it")}`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
        {t.mine != null && (
          <span className="badge badge-soft" title="Your score" style={{ fontWeight: 800 }}>{tr("You")} {t.mine}</span>
        )}
        <span className="badge badge-soft" title={groupAvg != null ? "Group average (yours included)" : "Friends' average"} style={{ fontWeight: 800 }}>
          <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
          {fmt(groupAvg ?? t.friendAvg)}
        </span>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, more, children }: {
  icon: typeof Star; title: string; more?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="eyebrow flex items-center gap-1.5"><Icon size={13} />{title}</div>
      {children}
      {more}
    </section>
  );
}

const GRID = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" } as const;

export default function StatsPage() {
  const stats = useStats();
  const open = useOpenTitle();

  const recommended = useShowMore(stats.recommended, 12);
  const compared = useShowMore(stats.compared, 12);
  const worst = useShowMore(stats.worst, 12);

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Friends stats")}</h1>

      {stats.loading ? (
        <div className="dim">{tr("Loading…")}</div>
      ) : !stats.hasFriends ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr("No friends yet — add someone on the Friends tab to unlock the friends stats.")}</p>
        </div>
      ) : (
        <>
          <Section icon={TrendingUp} title={tr("Recommended by friends")} more={recommended.more}>
            {stats.recommended.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("Nothing to recommend — you've seen everything your friends rated.")}</p>
            ) : (
              <div style={GRID}>
                {recommended.shown.map((t) => <StatRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>

          <Section icon={Award} title={tr("Your scores vs theirs")} more={compared.more}>
            {stats.compared.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("No overlap yet — rate a few shows your friends also scored.")}</p>
            ) : (
              <div style={GRID}>
                {compared.shown.map((t) => <StatRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>

          <Section icon={ThumbsDown} title={tr("Worst watched together")} more={worst.more}>
            {stats.worst.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>{tr("No shared stinkers yet — lucky you.")}</p>
            ) : (
              <div style={GRID}>
                {worst.shown.map((t) => <StatRow key={t.tmdb_id} t={t} groupAvg={t.groupAvg} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
