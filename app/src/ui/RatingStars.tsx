import { useState } from "react";
import { Star } from "lucide-react";

/* La nota que pones tú, en estrellas. Compartida por las dos fichas — la de
   series y la de cine — que puntúan lo mismo (`ratings.title_id`) con el mismo
   control. Vivía dentro de DetailSheet hasta que hubo una segunda ficha. */

/* Interactive 5-star rating on a 1-10 scale (each half-star = 1 point). Hovering
   previews the score you'd set — the stars fill dimmed and the number shows the
   pending value; clicking commits it. */
/** `size` es el lado de cada estrella en píxeles, y por debajo el ancho de
 *  cada media — que es el blanco real al que se apunta. Por defecto 24 (el de
 *  siempre); la ficha de un título pide 30, que es lo que entra en su héroe sin
 *  empujar a las notas ajenas. */
export function RatingStars({ value, onRate, size = 24 }: { value: number; onRate: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value; // 0-10
  const previewing = hover != null;
  return (
    <div className="flex items-center gap-2.5">
      <div className={`rating-stars${previewing ? " previewing" : ""}`} style={{ "--star": `${size}px` } as React.CSSProperties} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((i) => {
          const pct = shown >= i * 2 ? 100 : shown >= i * 2 - 1 ? 50 : 0;
          return (
            <span key={i} className="rating-star">
              <Star size={size} strokeWidth={1.6} className="rating-star-bg" />
              <span className="rating-star-fg" style={{ width: `${pct}%` }}>
                <Star size={size} strokeWidth={0} fill="currentColor" />
              </span>
              <span className="rating-half left" onMouseEnter={() => setHover(i * 2 - 1)} onClick={() => onRate(i * 2 - 1)} />
              <span className="rating-half right" onMouseEnter={() => setHover(i * 2)} onClick={() => onRate(i * 2)} />
            </span>
          );
        })}
      </div>
      <span className={`rating-num${previewing ? " dim" : ""}`}>
        {shown ? `${shown}/10` : "—"}
      </span>
    </div>
  );
}
