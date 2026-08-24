import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, User } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { t as tr } from "@/lib/i18n";
import type { CastMember } from "@/lib/schemas";

/* El reparto, en una fila. Compartido por las dos fichas: en series el reparto
   es agregado de toda la serie y en cine es el de la película, pero la fila y
   su comportamiento son los mismos. Vivía dentro de DetailSheet hasta que hubo
   una segunda ficha. */

/* Top-billed cast on one scrollable row. Arrows float over the row's edges
   (hidden on touch, where you swipe) and only render when there's more to
   scroll on that side. */
export function CastRail({ cast, onPick }: { cast: CastMember[]; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(update); // re-measure on every render (cast load / width change)
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="cast-rail">
      <div className="flex gap-3 overflow-x-auto no-scrollbar" ref={ref} onScroll={update} style={{ paddingBottom: 4 }}>
        {cast.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className="flex flex-col items-center gap-1.5"
            style={{ width: 96, flex: "0 0 auto", cursor: "pointer", textAlign: "center" }}
            title={c.name}
            onClick={() => onPick(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(c.id); }
            }}
          >
            <span
              className="grid place-items-center overflow-hidden"
              style={{
                width: 88, height: 88, borderRadius: "50%", background: "var(--surface-3)",
                border: "1px solid var(--border)", flex: "0 0 auto", color: "var(--text-dim)",
              }}
            >
              {tmdbImg(c.profile_path, "w180_and_h180_face") ? (
                <img
                  src={tmdbImg(c.profile_path, "w180_and_h180_face")}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <User size={32} />
              )}
            </span>
            <span className="truncate" style={{ fontSize: 12, fontWeight: 650, width: "100%" }}>{c.name}</span>
            {c.character && (
              <span className="mute truncate" style={{ fontSize: 11, width: "100%", marginTop: -4 }}>{c.character}</span>
            )}
          </div>
        ))}
      </div>
      {canL && (
        <button className="rail-arrow cast-edge left" onClick={() => nudge(-1)} aria-label={tr("Earlier cast")}>
          <ChevronLeft size={18} />
        </button>
      )}
      {canR && (
        <button className="rail-arrow cast-edge right" onClick={() => nudge(1)} aria-label={tr("More cast")}>
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}
