export type Kind = "tv" | "movie";
export type Status = "watching" | "caughtup" | "watchlist" | "upcoming" | "finished";

export interface NextEp {
  s: number;
  e: number;
  title: string;
  air: string; // display string
}

export interface Title {
  id: string;
  title: string;
  kind: Kind;
  year: string;
  genres: string[];
  network: string;
  tmdb: number; // community score 0-10
  myScore?: number; // your score 0-10
  status: Status;
  synopsis: string;
  // watching
  seenEps?: number;
  totalEps?: number;
  next?: NextEp;
  // upcoming / announced
  premiere?: string; // "2026-08-14" | "TBA 2026" | "Announced"
  premiereLabel?: string;
  // caught up — fully watched, waiting on the next season
  waitingFor?: string; // "Season 3 — expected 2027"
  // finished / movie
  runtime?: string;
}

/* deterministic hue from a string, for poster gradients */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export const GENRES = ["Drama", "Comedy", "Sci-Fi", "Thriller", "Crime", "Fantasy", "Animation", "Documentary"];

export const TITLES: Title[] = [
  // ---------- WATCHING (TV) ----------
  {
    id: "severance", title: "Severance", kind: "tv", year: "2022", genres: ["Sci-Fi", "Thriller", "Drama"],
    network: "Apple TV+", tmdb: 8.4, myScore: 9, status: "watching", seenEps: 15, totalEps: 19,
    next: { s: 2, e: 6, title: "Attila", air: "New · aired Jun 28" },
    synopsis: "Mark leads a team of office workers whose memories have been surgically divided between work and personal life.",
  },
  {
    id: "the-bear", title: "The Bear", kind: "tv", year: "2022", genres: ["Drama", "Comedy"],
    network: "FX", tmdb: 8.5, myScore: 8, status: "watching", seenEps: 20, totalEps: 28,
    next: { s: 3, e: 4, title: "Violet", air: "Up next" },
    synopsis: "A young chef from the fine-dining world returns to Chicago to run his family's sandwich shop.",
  },
  {
    id: "shogun", title: "Shōgun", kind: "tv", year: "2024", genres: ["Drama", "Fantasy"],
    network: "FX", tmdb: 8.6, myScore: 9, status: "watching", seenEps: 7, totalEps: 10,
    next: { s: 1, e: 8, title: "The Abyss of Life", air: "Up next" },
    synopsis: "In feudal Japan, a shipwrecked English pilot becomes entangled in a ruthless struggle for power.",
  },
  {
    id: "slow-horses", title: "Slow Horses", kind: "tv", year: "2022", genres: ["Thriller", "Drama"],
    network: "Apple TV+", tmdb: 8.1, myScore: 8, status: "watching", seenEps: 18, totalEps: 24,
    next: { s: 4, e: 1, title: "Identity Theft", air: "New season · Jul 1" },
    synopsis: "A dysfunctional team of MI5 agents serve out their careers in a dumping-ground department.",
  },
  {
    id: "andor", title: "Andor", kind: "tv", year: "2022", genres: ["Sci-Fi", "Drama"],
    network: "Disney+", tmdb: 8.4, status: "watching", seenEps: 9, totalEps: 12,
    next: { s: 1, e: 10, title: "One Way Out", air: "Up next" },
    synopsis: "The birth of a rebellion, and the beginnings of a galaxy-spanning fight against tyranny.",
  },
  {
    id: "fallout", title: "Fallout", kind: "tv", year: "2024", genres: ["Sci-Fi", "Drama"],
    network: "Prime Video", tmdb: 8.3, myScore: 8, status: "watching", seenEps: 5, totalEps: 8,
    next: { s: 1, e: 6, title: "The Trap", air: "Up next" },
    synopsis: "Two hundred years after the apocalypse, the gentle denizens of a vault must contend with the wasteland.",
  },

  // ---------- CAUGHT UP (watched all aired, waiting on more seasons) ----------
  {
    id: "silo", title: "Silo", kind: "tv", year: "2023", genres: ["Sci-Fi", "Thriller", "Drama"],
    network: "Apple TV+", tmdb: 8.0, myScore: 8, status: "caughtup", seenEps: 20, totalEps: 20,
    waitingFor: "Season 3 — expected 2027",
    synopsis: "Ten thousand people live in a giant underground silo, bound by rules they believe protect them.",
  },
  {
    id: "the-white-lotus", title: "The White Lotus", kind: "tv", year: "2021", genres: ["Drama", "Comedy"],
    network: "HBO", tmdb: 8.0, myScore: 9, status: "caughtup", seenEps: 21, totalEps: 21,
    waitingFor: "Season 4 — filming",
    synopsis: "The exploits of the guests and staff at an exclusive tropical resort unravel across a single week.",
  },
  {
    id: "the-mandalorian", title: "The Mandalorian", kind: "tv", year: "2019", genres: ["Sci-Fi", "Fantasy"],
    network: "Disney+", tmdb: 8.2, myScore: 8, status: "caughtup", seenEps: 24, totalEps: 24,
    waitingFor: "Season 4 — in production",
    synopsis: "A lone bounty hunter travels the outer reaches of the galaxy, far from the authority of the New Republic.",
  },
  {
    id: "the-diplomat-cu", title: "Yellowjackets", kind: "tv", year: "2021", genres: ["Drama", "Thriller"],
    network: "Netflix", tmdb: 7.9, myScore: 8, status: "caughtup", seenEps: 19, totalEps: 19,
    waitingFor: "Season 4 — announced",
    synopsis: "A team of teenage soccer players survive a plane crash in the wilderness — and the women they become.",
  },

  // ---------- WATCHLIST ----------
  {
    id: "dark", title: "Dark", kind: "tv", year: "2017", genres: ["Sci-Fi", "Thriller", "Crime"],
    network: "Netflix", tmdb: 8.4, status: "watchlist",
    synopsis: "A missing child sets four families on a frantic hunt for answers as they unearth a mind-bending mystery.",
  },
  {
    id: "the-leftovers", title: "The Leftovers", kind: "tv", year: "2014", genres: ["Drama", "Fantasy"],
    network: "HBO", tmdb: 8.0, status: "watchlist",
    synopsis: "Three years after 2% of the world's population vanished, those left behind struggle to find meaning.",
  },
  {
    id: "arcane", title: "Arcane", kind: "tv", year: "2021", genres: ["Animation", "Fantasy"],
    network: "Netflix", tmdb: 8.7, status: "watchlist",
    synopsis: "Amid the stark divide between the cities of Piltover and Zaun, two sisters fight on rival sides.",
  },
  {
    id: "the-diplomat", title: "The Diplomat", kind: "tv", year: "2023", genres: ["Drama", "Thriller"],
    network: "Netflix", tmdb: 7.6, status: "watchlist",
    synopsis: "A career diplomat lands in a high-profile job for which she is not suited, with her marriage tested.",
  },

  // ---------- UPCOMING / ANNOUNCED ----------
  {
    id: "severance-3", title: "Severance", kind: "tv", year: "2026", genres: ["Sci-Fi", "Thriller"],
    network: "Apple TV+", tmdb: 8.4, status: "upcoming", premiere: "2026-07-18", premiereLabel: "Season 3 · Jul 18",
    synopsis: "The next chapter of the Macrodata Refinement saga picks up moments after the season 2 cliffhanger.",
  },
  {
    id: "wednesday-2", title: "Wednesday", kind: "tv", year: "2026", genres: ["Comedy", "Fantasy", "Crime"],
    network: "Netflix", tmdb: 8.1, status: "upcoming", premiere: "2026-08-06", premiereLabel: "Season 2 · Aug 6",
    synopsis: "Wednesday Addams returns to Nevermore for a new year of mystery, mayhem and macabre.",
  },
  {
    id: "the-last-of-us-3", title: "The Last of Us", kind: "tv", year: "2026", genres: ["Drama", "Sci-Fi"],
    network: "HBO", tmdb: 8.7, status: "upcoming", premiere: "2026-09-13", premiereLabel: "Season 3 · Sep 13",
    synopsis: "The acclaimed post-pandemic saga continues, shifting perspective as new factions collide.",
  },
  {
    id: "house-of-dragon-3", title: "House of the Dragon", kind: "tv", year: "2026", genres: ["Fantasy", "Drama"],
    network: "HBO", tmdb: 8.4, status: "upcoming", premiere: "2026-10", premiereLabel: "Season 3 · October",
    synopsis: "The Dance of the Dragons burns hotter as the Greens and Blacks commit to all-out war.",
  },
  {
    id: "pluribus", title: "Pluribus", kind: "tv", year: "2026", genres: ["Sci-Fi", "Drama"],
    network: "Apple TV+", tmdb: 0, status: "upcoming", premiere: "TBA 2026", premiereLabel: "New series · TBA 2026",
    synopsis: "A genre-bending new drama from the creator of Breaking Bad. Details are being kept under wraps.",
  },
  {
    id: "blade-runner-2099", title: "Blade Runner 2099", kind: "tv", year: "2026", genres: ["Sci-Fi", "Thriller"],
    network: "Prime Video", tmdb: 0, status: "upcoming", premiere: "Announced", premiereLabel: "Announced · no date yet",
    synopsis: "A live-action sequel series set fifty years after the events of Blade Runner 2049. In production.",
  },
  {
    id: "the-rings-3", title: "The Lord of the Rings: The Rings of Power", kind: "tv", year: "2026", genres: ["Fantasy", "Drama"],
    network: "Prime Video", tmdb: 6.9, status: "upcoming", premiere: "Announced", premiereLabel: "Season 3 · in development",
    synopsis: "The forging of the rings continues as the shadow of Sauron lengthens across Middle-earth.",
  },

  // ---------- FINISHED (TV) ----------
  {
    id: "breaking-bad", title: "Breaking Bad", kind: "tv", year: "2008", genres: ["Crime", "Drama", "Thriller"],
    network: "AMC", tmdb: 8.9, myScore: 10, status: "finished", seenEps: 62, totalEps: 62,
    synopsis: "A chemistry teacher diagnosed with cancer teams with a former student to secure his family's future.",
  },
  {
    id: "chernobyl", title: "Chernobyl", kind: "tv", year: "2019", genres: ["Drama", "Documentary"],
    network: "HBO", tmdb: 8.6, myScore: 10, status: "finished", seenEps: 5, totalEps: 5,
    synopsis: "In April 1986 an explosion at the Chernobyl nuclear plant becomes one of history's worst man-made disasters.",
  },
  {
    id: "the-wire", title: "The Wire", kind: "tv", year: "2002", genres: ["Crime", "Drama"],
    network: "HBO", tmdb: 8.6, myScore: 9, status: "finished", seenEps: 60, totalEps: 60,
    synopsis: "The Baltimore drug scene seen through the eyes of law enforcement and the dealers they pursue.",
  },
];

export const byId = (id: string) => TITLES.find((t) => t.id === id);
export const inStatus = (s: Status) => TITLES.filter((t) => t.status === s);

/* Fake seasons/episode list for the detail view */
export function fakeEpisodes(t: Title) {
  const perSeason = 8;
  const seenTotal = t.seenEps ?? 0;
  const rows: { s: number; e: number; title: string; air: string; seen: boolean; idx: number }[] = [];
  const names = ["The Signal", "Half Bloom", "Ghost Light", "Undertow", "The Long Now",
    "Static", "Bright Hours", "Cauterize", "In Absentia", "The Cut"];
  let idx = 0;
  const totalEps = t.totalEps ?? perSeason;
  const seasons = Math.max(1, Math.ceil(totalEps / perSeason));
  for (let s = 1; s <= seasons; s++) {
    for (let e = 1; e <= perSeason && idx < totalEps; e++) {
      idx++;
      rows.push({
        s, e,
        title: names[(idx - 1) % names.length],
        air: `202${(3 + s) % 6}`,
        seen: idx <= seenTotal,
        idx,
      });
    }
  }
  return rows;
}

/* Upcoming episodes for a followed show, for the Calendar "My shows" view.
   Dates are synthesized weekly from the app's "today" (Sat, Jul 4 2026). */
const CAL_BASE = new Date(2026, 6, 4);
const EP_NAMES = ["The Long Now", "Bright Hours", "Cauterize", "In Absentia", "The Cut",
  "Undertow", "Static", "Ghost Light", "Half Bloom", "The Signal"];

export interface UpcomingEp { s: number; e: number; title: string; date: string; soon: boolean; }

export function scheduledEpisodes(t: Title): UpcomingEp[] {
  if (t.status !== "watching" || !t.next) return [];
  const remaining = Math.max(1, Math.min(5, (t.totalEps ?? 8) - (t.seenEps ?? 0)));
  const startOffset = 3 + (hueOf(t.title) % 6);
  const rows: UpcomingEp[] = [];
  for (let i = 0; i < remaining; i++) {
    const d = new Date(CAL_BASE);
    d.setDate(d.getDate() + startOffset + i * 7);
    const e = t.next.e + i;
    rows.push({
      s: t.next.s,
      e,
      title: EP_NAMES[(e + i) % EP_NAMES.length],
      date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      soon: i === 0,
    });
  }
  return rows;
}
