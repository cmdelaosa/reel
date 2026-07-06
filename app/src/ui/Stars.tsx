import { Star } from "lucide-react";

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
