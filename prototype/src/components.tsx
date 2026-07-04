import { createContext, useContext } from "react";
import { Star, Check, Plus, Bell, Play } from "lucide-react";
import { Title, hueOf } from "./data";

/* ---- App-wide UI context (open detail sheet) ---- */
export const UICtx = createContext<{ open: (id: string) => void }>({ open: () => {} });
export const useUI = () => useContext(UICtx);

/* ---- Logo ---- */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className="grid place-items-center"
        style={{
          width: 34, height: 34, borderRadius: "var(--r-sm)",
          background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
          color: "var(--on-accent)", boxShadow: "0 6px 16px -6px color-mix(in srgb, var(--accent) 70%, transparent)",
        }}
      >
        <Play size={18} fill="currentColor" strokeWidth={0} />
      </div>
      {!compact && (
        <div className="leading-none">
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Reel</div>
          <div style={{ fontSize: 10.5, color: "var(--text-mute)", fontWeight: 600, letterSpacing: ".14em" }}>TRACKER</div>
        </div>
      )}
    </div>
  );
}

/* ---- Poster gradient ---- */
export function posterBg(title: string): string {
  const h = hueOf(title);
  const h2 = (h + 42) % 360;
  return `linear-gradient(155deg, hsl(${h} 46% 30%), hsl(${h2} 58% 15%))`;
}

/* ---- Brand logo lozenges (offline-safe stand-ins for real network logos) ---- */
const NETS: Record<string, { label: string; bg: string; fg: string }> = {
  "Netflix":     { label: "N",      bg: "#E50914", fg: "#ffffff" },
  "Apple TV+":   { label: "tv", bg: "#000000", fg: "#ffffff" },
  "HBO":         { label: "HBO",    bg: "#000000", fg: "#ffffff" },
  "FX":          { label: "FX",     bg: "#000000", fg: "#ffffff" },
  "Disney+":     { label: "D+",     bg: "#0c3fc4", fg: "#ffffff" },
  "Prime Video": { label: "prime",  bg: "#00A8E1", fg: "#ffffff" },
  "AMC":         { label: "AMC",    bg: "#000000", fg: "#ffffff" },
};

export function NetworkLogo({ network, size = 11 }: { network: string; size?: number }) {
  const n = NETS[network] ?? { label: network.slice(0, 2).toUpperCase(), bg: "#2b3242", fg: "#e9edf5" };
  return (
    <span
      title={network}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: size + 10, minWidth: size + 10, padding: "0 7px",
        borderRadius: 6, background: n.bg, color: n.fg,
        fontSize: size, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1,
        boxShadow: "0 1px 5px rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {n.label}
    </span>
  );
}

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle }: { t: Title; subtitle?: string }) {
  const { open } = useUI();
  const progress = t.seenEps && t.totalEps ? Math.round((t.seenEps / t.totalEps) * 100) : 0;
  const showProgress = t.status === "watching" && progress > 0 && progress < 100;

  return (
    <div className="poster" style={{ background: posterBg(t.title) }} onClick={() => open(t.id)}>
      <div className="poster-sheen" />
      <div className="poster-top">
        <NetworkLogo network={t.network} />
        {t.tmdb > 0 && (
          <span className="badge badge-glass">
            <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
            {t.tmdb.toFixed(1)}
          </span>
        )}
      </div>
      <div className="poster-body">
        {t.status === "upcoming" && t.premiereLabel && (
          <span className="badge badge-accent" style={{ alignSelf: "flex-start", marginBottom: 8 }}>
            {t.premiereLabel}
          </span>
        )}
        <div className="poster-title">{t.title}</div>
        <div className="poster-sub">{subtitle ?? `${t.genres[0]} · ${t.year}`}</div>
      </div>
      {showProgress && (
        <div className="pbar">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

/* ---- Star rating (0-10 shown as 5 stars) ---- */
export function Stars({ score, size = 15 }: { score?: number; size?: number }) {
  const filled = Math.round((score ?? 0) / 2);
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={`star ${i <= filled ? "on" : ""}`}
          fill={i <= filled ? "currentColor" : "none"}
          strokeWidth={i <= filled ? 0 : 1.6}
        />
      ))}
    </span>
  );
}

/* ---- Small quick-action pill used on cards ---- */
export function QuickAdd({ label = "Add", icon = "plus" }: { label?: string; icon?: "plus" | "bell" | "check" }) {
  const I = icon === "bell" ? Bell : icon === "check" ? Check : Plus;
  return (
    <button className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
      <I size={15} />
      {label}
    </button>
  );
}
