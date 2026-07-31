/* Reactions on the activity feed — the pure half: the palette, and folding a
   page of reaction rows into the chips a row shows.

   One reaction per person per event (the table's primary key says so), so
   tapping a different emoji moves yours rather than stacking a second one. */

export const REACTIONS = ["❤️", "🔥", "😂", "😱", "🍿", "💤", "💩"] as const;
export type Emoji = (typeof REACTIONS)[number];

/** What each one means, for the screen reader: an emoji has no accessible name
 *  of its own, and "2, pressed, button" tells a blind reader nothing about
 *  whether the row got a 🔥 or a 💩. Dictionary keys — translated at the edge. */
export const REACTION_LABELS: Record<string, string> = {
  "❤️": "Love it",
  "🔥": "Brilliant",
  "😂": "Funny",
  "😱": "Shocking",
  "🍿": "Want to watch",
  "💤": "Boring",
  "💩": "Rubbish",
};

export interface ReactionRow {
  event_key: string;
  emoji: string;
  user_id: string;
  /** Null when the reactor keeps a private profile and is nobody you know —
   *  the reaction still counts, it just doesn't come with a name. */
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

/** A reactor as the chip shows them: a face, and a name when there is one. */
export interface ReactionPerson {
  id: string;
  /** Null for a name the caller isn't allowed to see (labelled "Someone"). */
  name: string | null;
  avatarUrl: string | null;
}

export interface ReactionChip {
  emoji: string;
  count: number;
  /** Who is behind the count, oldest reaction first. */
  people: ReactionPerson[];
  /** Whether the caller is one of them — the chip renders lit. */
  mine: boolean;
}

/** Index a page of reactions by the feed row they belong to. */
export function byEvent(rows: ReactionRow[]): Map<string, ReactionRow[]> {
  const map = new Map<string, ReactionRow[]>();
  for (const r of rows) {
    const list = map.get(r.event_key);
    if (list) list.push(r);
    else map.set(r.event_key, [r]);
  }
  return map;
}

const ORDER = new Map<string, number>(REACTIONS.map((e, i) => [e, i]));

/** One chip per emoji used, in palette order. An emoji outside the palette —
 *  left by a build with a different set — still renders, after the known ones,
 *  because dropping it would make the counts disagree with the row above. */
export function chipsFor(rows: ReactionRow[], me: string): ReactionChip[] {
  const chips = new Map<string, ReactionChip>();
  for (const r of rows) {
    let chip = chips.get(r.emoji);
    if (!chip) {
      chip = { emoji: r.emoji, count: 0, people: [], mine: false };
      chips.set(r.emoji, chip);
    }
    chip.count++;
    chip.people.push({ id: r.user_id, name: r.display_name, avatarUrl: r.avatar_url });
    if (r.user_id === me) chip.mine = true;
  }
  const rank = (e: string) => ORDER.get(e) ?? REACTIONS.length;
  return [...chips.values()].sort((a, b) => rank(a.emoji) - rank(b.emoji));
}

/** The caller's own reaction on this event, if they left one. */
export function myEmoji(rows: ReactionRow[], me: string): string | null {
  return rows.find((r) => r.user_id === me)?.emoji ?? null;
}

/** "Ana", "Ana and Leo", "Ana and 3 more" — the names in a notification line.
 *  Takes the joined forms already translated, since word order is the caller's
 *  business, not this function's. */
export function nameList(
  names: string[],
  pair: (a: string, b: string) => string,
  overflow: (a: string, n: number) => string,
): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return pair(names[0], names[1]);
  return overflow(names[0], names.length - 1);
}
