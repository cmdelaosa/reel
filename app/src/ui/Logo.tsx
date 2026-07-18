import { Play } from "lucide-react";

export function Logo({ compact = false, tagline = true }: { compact?: boolean; tagline?: boolean }) {
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
          {tagline && (
            <div style={{ fontSize: 10.5, color: "var(--text-mute)", fontWeight: 600, letterSpacing: ".14em" }}>TRACKER</div>
          )}
        </div>
      )}
    </div>
  );
}
