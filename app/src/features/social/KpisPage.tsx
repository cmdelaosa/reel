import { useMemo } from "react";
import { Award, Star, ThumbsDown, TrendingUp } from "lucide-react";
import { useLibrary } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { useFriendships } from "@/lib/friends";
import { useFriendsRatings, type FriendRatingRow } from "@/lib/taste";
import { useIgnored } from "@/lib/ignore";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { tmdbImg } from "@/lib/tmdb";
import { FriendStack, type FriendLike } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";

/* Group KPIs (route /friends/kpis) — the friend-group scoreboard Krauser asked
   for: what to watch next (unseen, loved by friends), the full you-vs-friends
   score comparison, and the stinkers the group sat through anyway. All three
   derive from the same one-round-trip friends-ratings query as /friends/taste. */

interface KpiTitle {
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  raters: FriendLike[];
  friendAvg: number;
  mine: number | null;
}

function useKpis() {
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

    const all: KpiTitle[] = [...byTitle.entries()].map(([tmdb_id, t]) => ({
      tmdb_id,
      name: t.meta.name,
      poster_path: t.meta.poster_path,
      raters: t.scores.map((s) => s.who),
      friendAvg: t.scores.reduce((sum, s) => sum + s.score, 0) / t.scores.length,
      mine: myScore.get(tmdb_id) ?? null,
    }));

    // (a) Unseen by you, recommended by friends: not in your library, best
    // friend average first (rater count breaks ties), curated to 10.
    const recommended = all
      .filter((t) => !inLibrary.has(t.tmdb_id) && t.mine == null && !isIgnored(t.tmdb_id))
      .sort((a, b) => b.friendAvg - a.friendAvg || b.raters.length - a.raters.length)
      .slice(0, 10);

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
      .sort((a, b) => a.groupAvg - b.groupAvg)
      .slice(0, 10);

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

function KpiRow({ t, groupAvg, onOpen }: { t: KpiTitle; groupAvg?: number; onOpen: () => void }) {
  const art = tmdbImg(t.poster_path, "w92");
  return (
    <div className="card mq-row" onClick={onOpen}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(t.name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={t.raters} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>
            {t.raters.length === 1 ? "1 friend rated it" : `${t.raters.length} friends rated it`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
        {t.mine != null && (
          <span className="badge badge-soft" title="Your score" style={{ fontWeight: 800 }}>You {t.mine}</span>
        )}
        <span className="badge badge-soft" title={groupAvg != null ? "Group average (yours included)" : "Friends' average"} style={{ fontWeight: 800 }}>
          <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
          {fmt(groupAvg ?? t.friendAvg)}
        </span>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, sub, children }: {
  icon: typeof Star; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <div className="eyebrow flex items-center gap-1.5"><Icon size={13} />{title}</div>
        <p className="mute" style={{ fontSize: 12.5, margin: "3px 0 0" }}>{sub}</p>
      </div>
      {children}
    </section>
  );
}

const GRID = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" } as const;

export default function KpisPage() {
  const kpis = useKpis();
  const open = useOpenTitle();

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Group stats</h1>
        <p className="dim mq-sub">The friend-group scoreboard — what to watch next, how your scores compare, and the shows everyone regrets.</p>
      </header>

      {kpis.loading ? (
        <div className="dim">Loading…</div>
      ) : !kpis.hasFriends ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>No friends yet — add someone on the Friends tab to unlock the group stats.</p>
        </div>
      ) : (
        <>
          <Section icon={TrendingUp} title="Recommended by friends" sub="Shows you haven't started, ranked by your friends' average score">
            {kpis.recommended.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>Nothing to recommend — you've seen everything your friends rated.</p>
            ) : (
              <div style={GRID}>
                {kpis.recommended.map((t) => <KpiRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>

          <Section icon={Award} title="Your scores vs theirs" sub="Every show you and at least one friend both rated">
            {kpis.compared.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>No overlap yet — rate a few shows your friends also scored.</p>
            ) : (
              <div style={GRID}>
                {kpis.compared.map((t) => <KpiRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>

          <Section icon={ThumbsDown} title="Worst watched together" sub="Lowest group averages among shows two or more of you scored">
            {kpis.worst.length === 0 ? (
              <p className="dim" style={{ fontSize: 13.5, margin: 0 }}>No shared stinkers yet — lucky you.</p>
            ) : (
              <div style={GRID}>
                {kpis.worst.map((t) => <KpiRow key={t.tmdb_id} t={t} groupAvg={t.groupAvg} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
