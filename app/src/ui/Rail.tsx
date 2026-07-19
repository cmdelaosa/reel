import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t as tr } from "@/lib/i18n";

/* Horizontal carousel with a header row: title/subtitle on the left and the two
   scroll arrows grouped at the top-right (opposite the title). Each arrow is
   disabled when there's no room to scroll that way. On a mouse it also
   drag-scrolls (click-hold and move); touch keeps native momentum scrolling.
   Reused for every horizontal rail.

   title/subtitle: the section heading, rendered inside the rail so the arrows
   can sit beside it. action: extra header content (e.g. a "See all" link) placed
   just left of the arrows.
   scrollToStartKey: bump this (any changing number) to smooth-scroll back to the
   start — Tonight uses it to follow a just-marked show to the front. */
export function Rail({
  children,
  title,
  subtitle,
  action,
  scrollToStartKey,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  scrollToStartKey?: number;
}) {
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

  // follow a marked show to the front: glide the rail back to the start. We ease
  // toward 0 by re-reading scrollLeft each frame (not a captured start) and keep
  // going through the reorder — the marked show only jumps to index 0 after the
  // up-next refetch, and scroll-snap then nudges scrollLeft off 0, so a fixed
  // tween would either no-op (we were already at 0) or get overridden. The lerp
  // catches that late nudge and pulls it back. Direct scrollLeft assignment (vs
  // scrollTo "smooth") isn't blocked by scroll-snap.
  useEffect(() => {
    if (!scrollToStartKey) return;
    const el = ref.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 == null) t0 = ts;
      const cur = el.scrollLeft;
      if (cur > 1) el.scrollLeft = cur * 0.78; // exponential ease → 0
      else el.scrollLeft = 0;
      if (ts - t0 < 750) raf = requestAnimationFrame(step); // outlast the refetch/reorder
    };
    if (!reduce) raf = requestAnimationFrame(step);
    // Guarantee the landing regardless of the rAF tween — it's paused in a hidden
    // tab and skipped under reduced-motion, and the up-next reorder can settle
    // late. Fires just after the tween window.
    const done = setTimeout(() => { el.scrollLeft = 0; }, reduce ? 0 : 800);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
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

  const hasHead = title != null || subtitle != null || action != null;

  return (
    <div className="rail-wrap">
      {hasHead && (
        <div className="rail-head">
          <div>
            {title != null && <h2 className="section-title">{title}</h2>}
            {subtitle != null && <p className="mute" style={{ fontSize: 13 }}>{subtitle}</p>}
          </div>
          <div className="rail-nav">
            {action}
            <button className="rail-arrow" onClick={() => nudge(-1)} disabled={!canL} aria-label={tr("Scroll left")}>
              <ChevronLeft size={18} />
            </button>
            <button className="rail-arrow" onClick={() => nudge(1)} disabled={!canR} aria-label={tr("Scroll right")}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
      <div
        className={`rail no-scrollbar${grabbing ? " grabbing" : ""}${scrollToStartKey !== undefined ? " no-snap" : ""}`}
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
    </div>
  );
}
