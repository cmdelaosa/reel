import { createContext, useContext, useMemo } from "react";
import { MapPin, Star, Tv, X, Eye, Heart } from "lucide-react";
import { Title, byId } from "./data";
import { Stars, useUI, posterBg, NetworkLogo } from "./components";
import { useWatchlist } from "./watchlist";

/* ============================================================
   FRIENDS — social layer. Hand-authored, deterministic data
   referencing real library ids, plus the derived views Explore
   uses (popular with friends, best rated, activity).
   ============================================================ */

export interface Friend {
  id: string;
  name: string;
  handle: string;
  location: string;
  hue: number;                                  // avatar / cover color
  tagline: string;
  epsWatched: string;
  timeSpent: string;
  watchingNow: { id: string; s: number; e: number }[];
  follows: string[];                            // title ids
  ratings: Record<string, number>;              // title id -> 0-10
}

export const FRIENDS: Friend[] = [
  {
    id: "marta", name: "Marta Ruiz", handle: "@marta.tv", location: "Madrid 🇪🇸", hue: 340,
    tagline: "Prestige drama or nothing.", epsWatched: "6,412", timeSpent: "54 days",
    watchingNow: [
      { id: "severance", s: 2, e: 4 },
      { id: "the-bear", s: 3, e: 2 },
      { id: "arcane", s: 2, e: 1 },
    ],
    follows: [
      "severance", "the-bear", "arcane", "succession", "the-white-lotus", "d-hacks",
      "the-leftovers", "mad-men", "sopranos", "twin-peaks", "d-ripley", "the-crown", "severance-3",
    ],
    ratings: {
      sopranos: 10, succession: 10, "the-leftovers": 10, "the-bear": 9, severance: 9,
      "mad-men": 9, arcane: 9, "twin-peaks": 8, "d-ripley": 8, "the-white-lotus": 8, "the-crown": 7,
    },
  },
  {
    id: "diego", name: "Diego Fernández", handle: "@dieguito", location: "Barcelona 🇪🇸", hue: 210,
    tagline: "Sci-fi first, ask questions later.", epsWatched: "8,930", timeSpent: "71 days",
    watchingNow: [
      { id: "fallout", s: 1, e: 5 },
      { id: "andor", s: 1, e: 6 },
      { id: "d-gen-v", s: 1, e: 3 },
    ],
    follows: [
      "fallout", "andor", "the-boys", "d-gen-v", "the-mandalorian", "breaking-bad",
      "better-call-saul", "dark", "westworld", "black-mirror", "squid-game", "silo",
      "stranger-things", "severance", "blade-runner-2099",
    ],
    ratings: {
      "breaking-bad": 10, "better-call-saul": 10, dark: 9, andor: 9, fallout: 8,
      "the-boys": 8, "black-mirror": 8, severance: 8, westworld: 7, "squid-game": 6,
    },
  },
  {
    id: "lucia", name: "Lucía Ortega", handle: "@lucia.wtf", location: "Valencia 🇪🇸", hue: 45,
    tagline: "Comfort comedies + one sad drama a year.", epsWatched: "4,205", timeSpent: "35 days",
    watchingNow: [
      { id: "the-white-lotus", s: 3, e: 5 },
      { id: "d-hacks", s: 3, e: 4 },
      { id: "ted-lasso", s: 2, e: 8 },
    ],
    follows: [
      "the-white-lotus", "d-hacks", "ted-lasso", "barry", "the-bear", "d-shrinking",
      "d-fallout2", "fargo", "six-feet-under", "succession", "the-crown",
    ],
    ratings: {
      "the-bear": 10, "six-feet-under": 10, "ted-lasso": 9, barry: 9, succession: 9,
      fargo: 8, "d-hacks": 8, "the-white-lotus": 8, "d-shrinking": 7,
    },
  },
  {
    id: "alex", name: "Álex Moreno", handle: "@alexplays", location: "Geneva 🇨🇭", hue: 150,
    tagline: "Slow-burn thrillers, faster reviews.", epsWatched: "7,118", timeSpent: "60 days",
    watchingNow: [
      { id: "shogun", s: 1, e: 7 },
      { id: "silo", s: 2, e: 3 },
      { id: "slow-horses", s: 3, e: 9 },
    ],
    follows: [
      "shogun", "silo", "slow-horses", "severance", "andor", "chernobyl", "band-of-brothers",
      "the-wire", "true-detective", "mindhunter", "ozark", "peaky-blinders", "sherlock", "d-dark-matter",
    ],
    ratings: {
      "the-wire": 10, chernobyl: 10, "band-of-brothers": 9, shogun: 9, "slow-horses": 9,
      "true-detective": 9, severance: 8, mindhunter: 8, sherlock: 8, ozark: 7,
    },
  },
  {
    id: "sara", name: "Sara Camacho", handle: "@sarabinge", location: "Sevilla 🇪🇸", hue: 275,
    tagline: "Horror at 2am is self-care.", epsWatched: "5,644", timeSpent: "47 days",
    watchingNow: [
      { id: "stranger-things", s: 4, e: 6 },
      { id: "d-the-penguin", s: 1, e: 5 },
      { id: "the-diplomat-cu", s: 2, e: 3 },
    ],
    follows: [
      "stranger-things", "hill-house", "the-diplomat-cu", "d-the-penguin", "d-ripley",
      "squid-game", "black-mirror", "got", "watchmen", "the-boys", "wednesday-2",
      "house-of-dragon-3", "d-the-diplomat2",
    ],
    ratings: {
      got: 9, "hill-house": 9, "d-the-penguin": 9, "stranger-things": 8, watchmen: 8,
      "the-diplomat-cu": 8, "black-mirror": 7, "squid-game": 7, "d-ripley": 7,
    },
  },
  {
    id: "pablo", name: "Pablo Maki", handle: "@pablomaki", location: "Bilbao 🇪🇸", hue: 20,
    tagline: "Rewatching The Wire counts as new TV.", epsWatched: "9,873", timeSpent: "82 days",
    watchingNow: [
      { id: "the-diplomat", s: 2, e: 3 },
      { id: "d-the-diplomat2", s: 1, e: 6 },
      { id: "the-mandalorian", s: 3, e: 2 },
    ],
    follows: [
      "the-diplomat", "d-the-diplomat2", "the-mandalorian", "got", "house-of-dragon-3",
      "the-rings-3", "fargo", "true-detective", "peaky-blinders", "sopranos", "breaking-bad",
      "severance", "d-pachinko",
    ],
    ratings: {
      "breaking-bad": 10, sopranos: 9, fargo: 9, "d-pachinko": 9, severance: 9,
      "the-diplomat": 8, got: 8, "peaky-blinders": 8, "true-detective": 8,
    },
  },
];

export const friendById = (id: string) => FRIENDS.find((f) => f.id === id);

/* ---- Derived views for Explore ---- */

/** Titles ranked by how many friends follow them (ties: friend avg rating). */
export function popularWithFriends(min = 2): { t: Title; fans: Friend[] }[] {
  const map = new Map<string, Friend[]>();
  FRIENDS.forEach((f) => f.follows.forEach((id) => map.set(id, [...(map.get(id) ?? []), f])));
  return [...map.entries()]
    .filter(([, fans]) => fans.length >= min)
    .map(([id, fans]) => ({ t: byId(id)!, fans }))
    .filter((x) => x.t)
    .sort((a, b) => b.fans.length - a.fans.length || friendAvg(b.t.id) - friendAvg(a.t.id));
}

/** Average friend rating for a title (0 when nobody rated it). */
export function friendAvg(id: string): number {
  const scores = FRIENDS.map((f) => f.ratings[id]).filter((n): n is number => n != null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

/** Titles with ≥2 friend ratings, ranked by average score. */
export function bestRatedByFriends(): { t: Title; avg: number; raters: Friend[] }[] {
  const ids = new Set(FRIENDS.flatMap((f) => Object.keys(f.ratings)));
  return [...ids]
    .map((id) => ({
      t: byId(id)!,
      raters: FRIENDS.filter((f) => f.ratings[id] != null),
      avg: friendAvg(id),
    }))
    .filter((x) => x.t && x.raters.length >= 2)
    .sort((a, b) => b.avg - a.avg || b.raters.length - a.raters.length);
}

/** Recent friend activity — hand-authored so the feed reads naturally. */
export const FRIEND_ACTIVITY: { friendId: string; verb: string; titleId: string; score?: number; when: string }[] = [
  { friendId: "marta", verb: "rated", titleId: "the-bear", score: 9, when: "2h ago" },
  { friendId: "alex", verb: "finished", titleId: "shogun", when: "5h ago" },
  { friendId: "sara", verb: "added", titleId: "d-the-penguin", when: "yesterday" },
  { friendId: "diego", verb: "rated", titleId: "fallout", score: 8, when: "yesterday" },
  { friendId: "lucia", verb: "started", titleId: "d-hacks", when: "2 days ago" },
  { friendId: "pablo", verb: "rated", titleId: "d-pachinko", score: 9, when: "3 days ago" },
];

/* ============================================================
   UI — avatars, stacks, and the friend profile sheet
   ============================================================ */

/** Open-friend-profile hook; the marquee root provides the setter. */
export const FriendCtx = createContext<{ openFriend: (id: string) => void }>({ openFriend: () => {} });
export const useFriends = () => useContext(FriendCtx);

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("");

export function FriendAvatar({ f, size = 40, ring = false }: { f: Friend; size?: number; ring?: boolean }) {
  return (
    <span
      className={`fr-avatar ${ring ? "fr-ring" : ""}`}
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${f.hue} 70% 52%), hsl(${(f.hue + 40) % 360} 72% 38%))`,
      }}
      title={f.name}
    >
      {initials(f.name)}
    </span>
  );
}

/** Overlapping row of small avatars, e.g. on posters: "who watches this". */
export function FriendStack({ fans, size = 24, max = 4 }: { fans: Friend[]; size?: number; max?: number }) {
  const shown = fans.slice(0, max);
  const extra = fans.length - shown.length;
  return (
    <span className="fr-stack">
      {shown.map((f) => <FriendAvatar key={f.id} f={f} size={size} ring />)}
      {extra > 0 && <span className="fr-avatar fr-ring fr-more" style={{ width: size, height: size, fontSize: size * 0.42 }}>+{extra}</span>}
    </span>
  );
}

/* ---- Friend profile sheet — same overlay pattern as the show detail ---- */
export function FriendSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const f = friendById(id);
  const wl = useWatchlist();
  const { open } = useUI();

  const shared = useMemo(
    () => (f ? f.follows.filter((tid) => wl.isFollowed(tid)) : []),
    [f, wl],
  );
  if (!f) return null;

  const match = Math.round((shared.length / f.follows.length) * 100);
  const followedTitles = f.follows.map(byId).filter((t): t is Title => !!t);
  const topRated = Object.entries(f.ratings)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([tid, score]) => ({ t: byId(tid)!, score }))
    .filter((x) => x.t);

  const stats = [
    { icon: Tv, label: "Shows", value: String(f.follows.length) },
    { icon: Eye, label: "Episodes", value: f.epsWatched },
    { icon: Star, label: "Rated", value: String(Object.keys(f.ratings).length) },
  ];

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        className="sheet-center fixed z-[70] card overflow-hidden flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(680px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
        }}
      >
        {/* Cover */}
        <div
          className="relative"
          style={{
            height: 116, flex: "0 0 auto",
            background: `linear-gradient(135deg, hsl(${f.hue} 55% 34%), hsl(${(f.hue + 50) % 360} 60% 18%))`,
          }}
        >
          <div className="poster-sheen" />
          <button className="btn btn-icon badge-glass absolute" style={{ top: 12, right: 12, color: "#fff" }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Identity */}
        <div className="px-6" style={{ marginTop: -34 }}>
          <div className="flex items-end gap-4 flex-wrap">
            <FriendAvatar f={f} size={76} ring />
            <div className="pb-1 min-w-0">
              <div style={{ fontSize: 21, fontWeight: 800 }}>{f.name}</div>
              <div className="dim flex items-center gap-1.5" style={{ fontSize: 13 }}>
                {f.handle} · <MapPin size={12} /> {f.location}
              </div>
            </div>
          </div>
          <p className="dim" style={{ fontSize: 13.5, margin: "10px 0 0" }}>{f.tagline}</p>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 pt-4 flex flex-col gap-6">
          {/* Stats + compatibility */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {stats.map((s) => (
              <div key={s.label} className="card p-3 flex flex-col gap-0.5">
                <s.icon size={16} style={{ color: "var(--accent)" }} />
                <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{s.value}</div>
                <div className="mute" style={{ fontSize: 11.5 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700 }}>
                <Heart size={15} style={{ color: "var(--accent)" }} />
                {match}% match with you
              </div>
              <span className="mute" style={{ fontSize: 12.5 }}>{shared.length} shows in common</span>
            </div>
            <div className="fr-matchbar"><i style={{ width: `${match}%` }} /></div>
          </div>

          {/* Watching now */}
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow">Watching now</div>
            {f.watchingNow.map((w) => {
              const t = byId(w.id);
              if (!t) return null;
              return (
                <div key={w.id} className="card mq-row" onClick={() => open(t.id)}>
                  <div className="mq-row-art" style={{ background: posterBg(t.title) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{t.title}</div>
                    <div className="dim" style={{ fontSize: 12.5 }}>On S{w.s} · E{w.e}</div>
                  </div>
                  <NetworkLogo network={t.network} size={11} />
                </div>
              );
            })}
          </section>

          {/* Their shows */}
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow">Follows · {followedTitles.length} shows</div>
            <div className="fr-grid">
              {followedTitles.map((t) => (
                <div
                  key={t.id}
                  className={`fr-mini ${wl.isFollowed(t.id) ? "fr-common" : ""}`}
                  style={{ background: posterBg(t.title) }}
                  title={wl.isFollowed(t.id) ? `${t.title} — you both follow this` : t.title}
                  onClick={() => open(t.id)}
                >
                  <span className="fr-mini-name">{t.title}</span>
                </div>
              ))}
            </div>
            <span className="mute" style={{ fontSize: 11.5 }}>Highlighted = shows you both follow.</span>
          </section>

          {/* Top ratings */}
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow">Their top ratings</div>
            {topRated.map(({ t, score }) => (
              <div key={t.id} className="card mq-row" onClick={() => open(t.id)}>
                <div className="mq-row-art" style={{ background: posterBg(t.title) }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{t.title}</div>
                  <Stars score={score} size={12} />
                </div>
                <span className="badge badge-soft" style={{ fontWeight: 800 }}>{score}/10</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
