import { Bell, Check, Plus } from "lucide-react";
import type { TitleCard } from "@/domain/types";
import { Logo, NetworkLogo, Poster, Rail, Stars } from "@/ui";
import { useSettings, setSetting, type AccentName, type ThemeName } from "@/lib/settings";

/* Living style guide: every base UI piece rendered from fixtures, for visual
   QA of the ported design system. Kept permanently at /kit. */

/* Self-contained demo art (data URI) so the poster_path image branch is
   provable offline — real TMDB URLs arrive with real data in Phase 2. */
const DEMO_ART =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a67"/><stop offset="1" stop-color="#0f1526"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="150" cy="70" r="46" fill="#ffb46a" opacity="0.85"/><path d="M0 220 L70 150 L120 210 L160 170 L200 220 L200 300 L0 300 Z" fill="#141c33"/></svg>`,
  );

const FIXTURES: TitleCard[] = [
  { id: "severance", name: "Severance", year: "2022", genres: ["Sci-Fi", "Thriller"], network: "Apple TV+", voteAverage: 8.4, progress: 68, posterPath: DEMO_ART },
  { id: "the-bear", name: "The Bear", year: "2022", genres: ["Comedy", "Drama"], network: "FX", voteAverage: 8.6, progress: 35 },
  { id: "andor", name: "Andor", year: "2022", genres: ["Sci-Fi", "Drama"], network: "Disney+", voteAverage: 8.3 },
  { id: "the-diplomat", name: "The Diplomat", year: "2023", genres: ["Drama", "Thriller"], network: "Netflix", voteAverage: 7.6 },
  { id: "hacks", name: "Hacks", year: "2021", genres: ["Comedy"], network: "HBO", voteAverage: 8.0, progress: 92 },
  { id: "fallout", name: "Fallout", year: "2024", genres: ["Sci-Fi", "Drama"], network: "Prime Video", voteAverage: 8.2 },
  { id: "dark-winds", name: "Dark Winds", year: "2022", genres: ["Crime", "Drama"], network: "AMC", voteAverage: 7.7 },
  { id: "unknown-net", name: "Local Heroes", year: "2025", genres: ["Documentary"], network: "Canal 9", voteAverage: 0 },
];

const THEMES: ThemeName[] = ["system", "dark", "oled", "light"];
const ACCENTS: AccentName[] = ["coral", "violet", "emerald", "amber"];
const NETWORKS = ["Netflix", "Apple TV+", "HBO", "FX", "AMC", "Disney+", "Prime Video", "Canal 9"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function KitPage() {
  const settings = useSettings();

  return (
    <div className="mq-main mq-page screen">
      <header className="mq-toolbar">
        <Logo />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="segmented">
            {THEMES.map((t) => (
              <button key={t} className={`seg ${settings.theme === t ? "seg-active" : ""}`} onClick={() => setSetting("theme", t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button key={a} className={`chip ${settings.accent === a ? "chip-active" : ""}`} onClick={() => setSetting("accent", a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      </header>

      <Section title="Posters">
        <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
          {FIXTURES.map((t) => (
            <Poster key={t.id} t={t} />
          ))}
        </div>
      </Section>

      <Section title="Rail">
        <Rail title="Trending" subtitle="Drag or use the arrows">
          {FIXTURES.map((t) => (
            <div key={t.id} style={{ width: "var(--rail-pw)" }}>
              <Poster t={t} />
            </div>
          ))}
        </Rail>
      </Section>

      <Section title="Buttons">
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn btn-accent"><Plus size={16} /> Add show</button>
          <button className="btn btn-outline">Outline</button>
          <button className="btn btn-ghost">Ghost</button>
          <button className="btn btn-ghost btn-sm"><Bell size={14} /> Notify me</button>
          <button className="btn btn-ghost btn-icon" aria-label="Watched"><Check size={16} /></button>
        </div>
      </Section>

      <Section title="Chips & badges">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="chip">Drama</span>
          <span className="chip chip-active">Sci-Fi</span>
          <span className="badge badge-accent">New season</span>
          <span className="badge badge-soft">Finished</span>
          <span className="badge badge-glass">8.4</span>
          <span className="badge badge-aired">Aired</span>
        </div>
      </Section>

      <Section title="Stars">
        <div className="flex items-center gap-6 flex-wrap">
          <Stars score={9} />
          <Stars score={6} />
          <Stars score={3} />
          <Stars score={0} />
        </div>
      </Section>

      <Section title="Network marks">
        <div className="flex items-center gap-3 flex-wrap">
          {NETWORKS.map((n) => (
            <NetworkLogo key={n} network={n} size={12} />
          ))}
        </div>
      </Section>

      <Section title="Card & episode row">
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="ep-row">
            <span className="check on"><Check size={15} /></span>
            <div className="flex-1 min-w-0">
              <div style={{ fontWeight: 700, fontSize: 14 }}>S2 · E7 — Chikhai Bardo</div>
              <div className="dim" style={{ fontSize: 12.5 }}>Severance · Apple TV+</div>
            </div>
            <span className="badge badge-soft">42 min</span>
          </div>
          <div className="ep-row">
            <span className="check"><Check size={15} /></span>
            <div className="flex-1 min-w-0">
              <div style={{ fontWeight: 700, fontSize: 14 }}>S2 · E8 — Sweet Vitriol</div>
              <div className="dim" style={{ fontSize: 12.5 }}>Severance · Apple TV+</div>
            </div>
            <span className="badge badge-soft">38 min</span>
          </div>
        </div>
      </Section>
    </div>
  );
}
