import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* Horizontal carousel with edge arrows that appear only when there's room to
   scroll that way. Reused for every horizontal rail. */
export function Rail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(update); // re-measure after every render (content/size changes)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div className="rail-wrap">
      <button className={`rail-arrow left ${canL ? "" : "hide"}`} onClick={() => nudge(-1)} aria-label="Scroll left">
        <ChevronLeft size={20} />
      </button>
      <div className="rail no-scrollbar" ref={ref} onScroll={update}>
        {children}
      </div>
      <button className={`rail-arrow right ${canR ? "" : "hide"}`} onClick={() => nudge(1)} aria-label="Scroll right">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
