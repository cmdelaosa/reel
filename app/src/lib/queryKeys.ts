/* Central TanStack Query keys — every key in the app lives here (ARCHITECTURE
   → Data-access conventions). */

export const qk = {
  profile: (userId: string) => ["profile", userId] as const,
  invited: (userId: string) => ["invited", userId] as const,
  search: (q: string) => ["search", q] as const,
  title: (tmdbId: number) => ["title", tmdbId] as const,
  season: (tmdbId: number, n: number) => ["season", tmdbId, n] as const,
  detailProgress: (titleId: string) => ["detailProgress", titleId] as const,
  library: ["library"] as const,
  watched: (titleId: string) => ["watched", titleId] as const,
  myRating: (titleId: string) => ["myRating", titleId] as const,
  upNext: ["upNext"] as const,
  calendarFeed: (fromIso: string, toIso: string) => ["calendarFeed", fromIso, toIso] as const,
  history: ["history"] as const,
  ratings: ["ratings"] as const,
  stats: ["stats"] as const,
  watchHeatmap: ["watchHeatmap"] as const,
  notifications: ["notifications"] as const,
  ignored: ["ignored"] as const,
  networkLogos: ["networkLogos"] as const,
  providers: (region: string, tmdbId: number) => ["providers", region, tmdbId] as const,
};
