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

/* ---- Network brand marks ----
   Netflix / Apple TV+ / Disney+ use the official vector logos (Wikimedia
   Commons SVGs served from /public/logos). The rest are styled wordmark
   stand-ins until real provider art arrives via TMDB. */
function NetTile({ title, bg, pad = 7, size, children }: {
  title: string; bg: string; pad?: number; size: number; children: React.ReactNode;
}) {
  const h = size + 10;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
        height: h, minWidth: h, padding: `0 ${pad}px`, borderRadius: 6,
        background: bg, boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.09)", overflow: "hidden", flex: "0 0 auto",
      }}
    >
      {children}
    </span>
  );
}

function Wordmark({ text, size, color = "#fff", weight = 800 }: { text: string; size: number; color?: string; weight?: number }) {
  return (
    <span style={{ fontSize: size, fontWeight: weight, color, letterSpacing: "-0.03em", lineHeight: 1, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

export function NetworkLogo({ network, size = 11 }: { network: string; size?: number }) {
  switch (network) {
    case "Netflix":
      return (
        <NetTile title="Netflix" bg="#000" pad={8} size={size}>
          <img
            src="/logos/netflix-n.svg"
            alt="Netflix"
            style={{ height: size + 6, display: "block" }}
          />
        </NetTile>
      );
    case "Apple TV+":
      /* Official app icon — self-contained dark tile with the tv mark */
      return (
        <img
          src="/logos/apple-tv.svg"
          alt="Apple TV+"
          title="Apple TV+"
          style={{
            /* square app icon: needs to run larger than the wordmark tiles
               for the inner tv mark to read at the same visual weight */
            height: size + 21, width: size + 21, display: "block", flex: "0 0 auto",
            borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.09)",
          }}
        />
      );
    case "HBO":
      return <NetTile title="HBO" bg="#000" size={size}><Wordmark text="HBO" size={size} /></NetTile>;
    case "FX":
      return <NetTile title="FX" bg="#000" pad={8} size={size}><Wordmark text="FX" size={size + 1} /></NetTile>;
    case "AMC":
      return <NetTile title="AMC" bg="#000" size={size}><Wordmark text="AMC" size={size - 0.5} /></NetTile>;
    case "Disney+":
      return (
        <NetTile title="Disney+" bg="linear-gradient(150deg,#0a2a46,#17b8c9)" pad={6} size={size}>
          <img
            src="/logos/disney-plus.svg"
            alt="Disney+"
            style={{ height: size + 5, display: "block", filter: "brightness(0) invert(1)" }}
          />
        </NetTile>
      );
    case "Prime Video":
      return (
        <NetTile title="Prime Video" bg="#1b2733" size={size}>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <Wordmark text="prime" size={size} />
            <svg width={size * 2.6} height={size * 0.5} viewBox="0 0 26 5" style={{ marginTop: 1, display: "block" }} aria-hidden>
              <path d="M1 1 C 9 5.5, 17 5.5, 25 1" fill="none" stroke="#00A8E1" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        </NetTile>
      );
    default:
      return <NetTile title={network} bg="#2b3242" size={size}><Wordmark text={network.slice(0, 2).toUpperCase()} size={size} color="#e9edf5" /></NetTile>;
  }
}

/* ---- Poster tile (overlaid title, TV-Time-like) ---- */
export function Poster({ t, subtitle, showNetwork = true }: { t: Title; subtitle?: string; showNetwork?: boolean }) {
  const { open } = useUI();
  const progress = t.seenEps && t.totalEps ? Math.round((t.seenEps / t.totalEps) * 100) : 0;
  const showProgress = t.status === "watching" && progress > 0 && progress < 100;

  return (
    <div className="poster" style={{ background: posterBg(t.title) }} onClick={() => open(t.id)}>
      <div className="poster-sheen" />
      <div className="poster-top">
        {showNetwork ? <NetworkLogo network={t.network} /> : <span />}
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
