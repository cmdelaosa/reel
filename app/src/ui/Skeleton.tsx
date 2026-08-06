/* Loading skeletons — shimmer placeholders that match final layout so there's
   no jump when data arrives.

   Every section that fetches gets one. A section that renders nothing while it
   loads doesn't just look empty, it reflows the whole page when it lands: the
   discover grid used to shove the collections down two seconds after Explore
   painted, and Tonight's hero appeared under a reader already scrolling. The
   sizes below are copied from the real components' CSS (the 21:9 hero frame,
   --rail-pw cards, the 2/3 poster) so the placeholder occupies exactly the box
   its content will. */

/** `action` adds the button row Discover's cards carry under the poster. It is
 *  not decoration: without it the placeholder is one --ctl-h-sm short per grid
 *  row, and everything below the grid still jumps when the real cards land
 *  (measured at 178px on a six-column desktop grid). Shows' cards have no
 *  button, so it defaults off. */
export function PosterGridSkeleton({ count = 12, action = false }: { count?: number; action?: boolean }) {
  return (
    <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="skeleton" style={{ aspectRatio: "2 / 3" }} />
          {action && <div className="skeleton" style={{ height: "var(--ctl-h-sm)" }} />}
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 92 }} />
      ))}
    </div>
  );
}

/** Tonight's banner. .mq-hero-frame is the same box .mq-hero occupies, shared
 *  in the stylesheet rather than restated here — the two differ at two
 *  breakpoints, and an inline copy silently lost both. */
export function HeroSkeleton() {
  return <div className="skeleton mq-hero-frame" />;
}

/** A rail's worth of cards, to be dropped inside <Rail> in place of its
 *  children — the header and its arrows then render as usual and don't shift
 *  when the real cards replace these. `caption` adds the two-line strip the
 *  continue-watching cards carry under the poster. */
export function RailCardsSkeleton({ count = 6, caption = false }: { count?: number; caption?: boolean }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ width: "var(--rail-pw)" }} className="flex flex-col gap-2">
          <div className="skeleton" style={{ aspectRatio: "2 / 3" }} />
          {caption && <div className="skeleton" style={{ height: 34 }} />}
        </div>
      ))}
    </>
  );
}

/** Stack of full-width rows — the activity feed, the calendar-style episode
 *  lists. `height` is the row's real height, not a guess: 64 for the compact
 *  mq-row, ~76 once a row carries a reaction strip. */
export function RowsSkeleton({ count = 5, height = 64 }: { count?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

/** Explore's collection tiles — same 16:9 grid the real cards lay out in. */
export function TileGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ aspectRatio: "16 / 9" }} />
      ))}
    </div>
  );
}
