import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useFriendships } from "@/lib/friends";
import { useMyRatings } from "@/lib/ratings";

/* Taste comparison: every accepted friend's show ratings in one query (the
   0015 friend-read RLS gates each row — private profiles simply contribute
   nothing), plus the affinity math shared by the taste page (/friends/taste),
   the Friends teaser card and the friend profile's match card. */

const friendRatingSchema = z.object({
  user_id: z.string().uuid(),
  score: z.number().int(),
  titles: z.object({
    tmdb_id: z.number().int(),
    kind: z.enum(["tv", "movie"]),
    name: z.string(),
    poster_path: z.string().nullable(),
  }),
});

export interface FriendRatingRow {
  user_id: string;
  score: number;
  tmdb_id: number;
  /** El medio del título puntuado — un tmdb_id solo es único dentro del suyo
   *  (0067), así que cruzar por el número a secas confunde los dos. */
  kind: "tv" | "movie";
  name: string;
  poster_path: string | null;
}

/** All show-level ratings of the given friends, one round trip. */
export function useFriendsRatings(friendIds: string[]) {
  return useQuery({
    queryKey: ["friendsRatings", [...friendIds].sort()],
    enabled: friendIds.length > 0,
    queryFn: async (): Promise<FriendRatingRow[]> => {
      const { data, error } = await supabase
        .from("ratings")
        .select("user_id, score, titles(tmdb_id, kind, name, poster_path)")
        .in("user_id", friendIds)
        .not("title_id", "is", null);
      if (error) throw error;
      return z.array(friendRatingSchema).parse(data).map((r) => ({
        user_id: r.user_id,
        score: r.score,
        ...r.titles,
      }));
    },
  });
}

export interface Affinity {
  pct: number;
  common: number;
  avgDiff: number;
}

/** Confidence-adjusted taste affinity between two score maps (tmdb_id → 1-10).
 *  Base similarity = 1 − avgAbsDiff/9 over co-rated shows; the co-rated count
 *  acts as confidence (n / (n + 4)), shrinking the figure toward the neutral
 *  50% so one lucky shared show can't read as a 100% soulmate. */
export function tasteAffinity(
  mine: Map<number, number>,
  theirs: Map<number, number>,
): Affinity | null {
  let common = 0;
  let diffSum = 0;
  for (const [tmdbId, myScore] of mine) {
    const theirScore = theirs.get(tmdbId);
    if (theirScore == null) continue;
    common++;
    diffSum += Math.abs(myScore - theirScore);
  }
  if (common === 0) return null;
  const avgDiff = diffSum / common;
  const similarity = 1 - avgDiff / 9;
  const confidence = common / (common + 4);
  const pct = Math.round((0.5 + (similarity - 0.5) * confidence) * 100);
  return { pct, common, avgDiff };
}

export interface TasteRater {
  id: string;
  name: string;
  avatarUrl: string | null;
  score: number;
}

/** A show you rated that at least one friend also rated. */
export interface TasteTitle {
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  mine: number;
  friendAvg: number;
  diff: number;
  raters: TasteRater[];
}

export interface TasteFriend {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  affinity: Affinity | null;
  /** The co-rated show where you disagree hardest (diff ≥ 2), if any. */
  clashTitle: string | null;
}

export interface Taste {
  loading: boolean;
  hasFriends: boolean;
  myRatedCount: number;
  /** Friends with at least one co-rated show, best match first. */
  ranked: TasteFriend[];
  /** Friends you share no rated shows with (yet). */
  unranked: TasteFriend[];
  /** Shows where your score and the friend average clash (diff ≥ 2). */
  clash: TasteTitle[];
  /** Shows the group scores like you do (diff ≤ 1), best first. */
  agree: TasteTitle[];
}

export function useTaste(): Taste {
  const { data: friendships = [], isPending: friendsPending } = useFriendships();
  const friends = useMemo(
    () => friendships.filter((f) => f.status === "accepted"),
    [friendships],
  );
  const friendIds = useMemo(() => friends.map((f) => f.other_id), [friends]);
  const { data: friendRatings = [], isPending: ratingsPending } = useFriendsRatings(friendIds);
  const { data: myRatings = [] } = useMyRatings();

  return useMemo(() => {
    const myScore = new Map(myRatings.map((r) => [r.titles.tmdb_id, r.score]));
    const byFriend = new Map<string, Map<number, number>>();
    const titleMeta = new Map<number, { name: string; poster_path: string | null }>();
    for (const r of friendRatings) {
      let scores = byFriend.get(r.user_id);
      if (!scores) byFriend.set(r.user_id, (scores = new Map()));
      scores.set(r.tmdb_id, r.score);
      titleMeta.set(r.tmdb_id, { name: r.name, poster_path: r.poster_path });
    }

    const ranked: TasteFriend[] = [];
    const unranked: TasteFriend[] = [];
    for (const f of friends) {
      const theirs = byFriend.get(f.other_id) ?? new Map<number, number>();
      const affinity = tasteAffinity(myScore, theirs);
      let clashTitle: string | null = null;
      let worst = 1; // only a real clash (diff ≥ 2) earns the label
      for (const [tmdbId, mine] of myScore) {
        const theirScore = theirs.get(tmdbId);
        if (theirScore == null) continue;
        const d = Math.abs(mine - theirScore);
        if (d > worst) {
          worst = d;
          clashTitle = titleMeta.get(tmdbId)?.name ?? null;
        }
      }
      const entry: TasteFriend = {
        id: f.other_id,
        name: f.display_name,
        handle: f.handle,
        avatarUrl: f.avatar_url,
        affinity,
        clashTitle,
      };
      (affinity ? ranked : unranked).push(entry);
    }
    ranked.sort((a, b) => b.affinity!.pct - a.affinity!.pct || b.affinity!.common - a.affinity!.common);

    const clash: TasteTitle[] = [];
    const agree: TasteTitle[] = [];
    for (const [tmdbId, mine] of myScore) {
      const raters: TasteRater[] = [];
      for (const f of friends) {
        const score = byFriend.get(f.other_id)?.get(tmdbId);
        if (score != null) raters.push({ id: f.other_id, name: f.display_name, avatarUrl: f.avatar_url, score });
      }
      if (raters.length === 0) continue;
      const friendAvg = raters.reduce((sum, r) => sum + r.score, 0) / raters.length;
      const diff = Math.abs(mine - friendAvg);
      const meta = titleMeta.get(tmdbId)!;
      const title: TasteTitle = { tmdb_id: tmdbId, ...meta, mine, friendAvg, diff, raters };
      if (diff >= 2) clash.push(title);
      else if (diff <= 1) agree.push(title);
    }
    clash.sort((a, b) => b.diff - a.diff || b.raters.length - a.raters.length);
    agree.sort((a, b) => b.mine + b.friendAvg - (a.mine + a.friendAvg) || a.diff - b.diff);

    return {
      loading: friendsPending || (friendIds.length > 0 && ratingsPending),
      hasFriends: friends.length > 0,
      myRatedCount: myScore.size,
      ranked,
      unranked,
      clash: clash.slice(0, 10),
      agree: agree.slice(0, 10),
    };
  }, [friends, friendIds, friendRatings, myRatings, friendsPending, ratingsPending]);
}
