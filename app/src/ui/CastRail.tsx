import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, User } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { t as tr } from "@/lib/i18n";
import type { RailPerson } from "@/ui/railPerson";

/* Una fila de caras redondas con su nombre y una línea debajo.
   Compartida por las tres cosas que la usan, que son la misma fila con datos
   distintos: el reparto de una serie, el de una película y —desde 0085— la
   dirección, el guion y los invitados de un episodio.

   Antes recibía `CastMember[]` de TMDB. Ahora recibe una forma mínima
   (`RailPerson`) porque el equipo de un episodio no es un CastMember: no tiene
   `character` sino puesto, y ese puesto se pinta en acento para distinguir "lo
   que hizo" de "a quién hace". Traducir al pasar es una línea en cada llamada
   y evita tener dos carruseles casi iguales.

   Las flechas flotan sobre los bordes de la fila y solo aparecen cuando queda
   sitio hacia ese lado; en táctil se esconden y se desliza. */

export function CastRail({ people, onPick }: { people: RailPerson[]; onPick: (id: number) => void }) {
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
        {people.map((p) => (
          <div
            key={`${p.id}-${p.sub ?? ""}`}
            role="button"
            tabIndex={0}
            className="flex flex-col items-center gap-1.5"
            style={{ width: 96, flex: "0 0 auto", cursor: "pointer", textAlign: "center" }}
            title={p.name}
            onClick={() => onPick(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p.id); }
            }}
          >
            <span
              className="grid place-items-center overflow-hidden"
              style={{
                width: 88, height: 88, borderRadius: "50%", background: "var(--surface-3)",
                border: "1px solid var(--border)", flex: "0 0 auto", color: "var(--text-dim)",
              }}
            >
              {tmdbImg(p.profile_path, "w180_and_h180_face") ? (
                <img
                  src={tmdbImg(p.profile_path, "w180_and_h180_face")}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <User size={32} />
              )}
            </span>
            <span className="truncate" style={{ fontSize: 12, fontWeight: 650, width: "100%" }}>{p.name}</span>
            {p.sub && (
              <span
                className="truncate"
                style={{
                  fontSize: 11, width: "100%", marginTop: -4,
                  color: p.subAccent ? "var(--accent)" : "var(--text-mute)",
                  fontWeight: p.subAccent ? 700 : undefined,
                }}
              >
                {p.sub}
              </span>
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
