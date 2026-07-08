import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* Horizontal carousel with edge arrows that appear only when there's room to
   scroll that way. On a mouse it also drag-scrolls (click-hold and move);
   touch keeps native momentum scrolling. Reused for every horizontal rail.

   scrollToStartKey: bump this (any changing number) to smooth-scroll back to the
   start — Tonight uses it to follow a just-marked show to the front. */
export function Rail({ children, scrollToStartKey }: { children: React.ReactNode; scrollToStartKey?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  // mouse drag bookkeeping; `moved` guards against the drag firing a card click.
  // We only capture the pointer once movement crosses a threshold — capturing on
  // pointerdown would redirect the click to the rail and break card/mark clicks.
  const drag = useRef({ active: false, captured: false, startX: 0, startLeft: 0, moved: 0 });

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

  // follow a marked show to the front: glide to the start after the reorder.
  // A hand-rolled rAF tween (not scrollTo behavior:"smooth") so it runs
  // consistently across browsers and doesn't get eaten by scroll-snap.
  useEffect(() => {
    if (!scrollToStartKey) return;
    const el = ref.current;
    if (!el || el.scrollLeft <= 0) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.scrollLeft = 0; return; }
    const start = el.scrollLeft;
    const duration = 460;
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 == null) t0 = ts;
      const p = Math.min(1, (ts - t0) / duration);
      el.scrollLeft = Math.round(start * (1 - p) ** 3); // easeOutCubic decay → 0
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrollToStartKey]);

  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return; // touch keeps native scrolling
    const el = ref.current;
    if (!el) return;
    // don't capture yet — a plain click must reach the card/mark button
    drag.current = { active: true, captured: false, startX: e.clientX, startLeft: el.scrollLeft, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!drag.current.active || !el) return;
    const dx = e.clientX - drag.current.startX;
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx));
    if (drag.current.moved <= 4) return; // still within click tolerance
    if (!drag.current.captured) {
      // capture keeps move events coming if the cursor leaves the rail; scrolling
      // works with or without it, so a failed capture never blocks the drag.
      try { el.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
      drag.current.captured = true;
      setGrabbing(true);
    }
    el.scrollLeft = drag.current.startLeft - dx;
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    if (drag.current.captured) { try { ref.current?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ } }
    drag.current.active = false;
    drag.current.captured = false;
    setGrabbing(false);
  };
  // a drag ends in a click; swallow it so it doesn't open a show / mark an episode
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved > 6) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = 0;
    }
  };

  return (
    <div className="rail-wrap">
      <button className={`rail-arrow left ${canL ? "" : "hide"}`} onClick={() => nudge(-1)} aria-label="Scroll left">
        <ChevronLeft size={20} />
      </button>
      <div
        className={`rail no-scrollbar${grabbing ? " grabbing" : ""}`}
        ref={ref}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      <button className={`rail-arrow right ${canR ? "" : "hide"}`} onClick={() => nudge(1)} aria-label="Scroll right">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
