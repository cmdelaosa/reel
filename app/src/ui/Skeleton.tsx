/* Loading skeletons — shimmer placeholders that match final layout so there's
   no jump when data arrives. */

export function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="skeleton" style={{ aspectRatio: "2 / 3" }} />
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
