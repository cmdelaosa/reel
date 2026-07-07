import { hueOf } from "@/ui/posterBg";

/* Friend avatar — initials on a hue gradient derived from a stable hash of the
   profile id. Ported from prototype friends.tsx. */

export interface FriendLike {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function FriendAvatar({ f, size = 40, ring = false }: { f: FriendLike; size?: number; ring?: boolean }) {
  const hue = hueOf(f.id);
  if (f.avatarUrl) {
    return (
      <span
        className={`fr-avatar ${ring ? "fr-ring" : ""}`}
        style={{ width: size, height: size, overflow: "hidden" }}
        title={f.name}
      >
        <img src={f.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </span>
    );
  }
  return (
    <span
      className={`fr-avatar ${ring ? "fr-ring" : ""}`}
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 72% 38%))`,
      }}
      title={f.name}
    >
      {initials(f.name)}
    </span>
  );
}

/** Overlapping row of small avatars ("who watches this"). */
export function FriendStack({ fans, size = 24, max = 4 }: { fans: FriendLike[]; size?: number; max?: number }) {
  const shown = fans.slice(0, max);
  const extra = fans.length - shown.length;
  return (
    <span className="fr-stack">
      {shown.map((f) => <FriendAvatar key={f.id} f={f} size={size} ring />)}
      {extra > 0 && (
        <span className="fr-avatar fr-ring fr-more" style={{ width: size, height: size, fontSize: size * 0.42 }}>+{extra}</span>
      )}
    </span>
  );
}
