import { useState } from "react";
import { useSearchParams } from "react-router";
import { useLibrary, toTitleCard, type LibraryShow } from "@/lib/library";
import type { ShowStatus } from "@/domain/status";
import { Poster } from "@/ui";

/* My Shows — the library grid with status buckets. Port of prototype
   marquee.tsx → Shows, on live data. */

const FILTERS: { key: ShowStatus | "all"; label: string }[] = [
  { key: "watching", label: "Watching" },
  { key: "caughtup", label: "Caught up" },
  { key: "watchlist", label: "Watchlist" },
  { key: "upcoming", label: "Upcoming" },
  { key: "finished", label: "Finished" },
  { key: "all", label: "All" },
];

export default function ShowsPage() {
  const { data: library = [], isPending } = useLibrary();
  const [f, setF] = useState<ShowStatus | "all">("watching");
  const [sort, setSort] = useState<"az" | "rating">("az");
  const [, setSearchParams] = useSearchParams();

  const inBucket = (s: LibraryShow) => f === "all" || s.status === f;
  const items = library.filter(inBucket).sort((a, b) =>
    sort === "az" ? a.name.localeCompare(b.name) : (b.vote_average ?? 0) - (a.vote_average ?? 0),
  );

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">My Shows</h1>
        <p className="dim mq-sub">
          {isPending ? "Loading your watchlist…" : `${library.length} shows in your watchlist.`}
        </p>
      </header>

      <div className="mq-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {x.label}
              <span className="mute" style={{ fontWeight: 700 }}>
                {x.key === "all" ? library.length : library.filter((s) => s.status === x.key).length}
              </span>
            </button>
          ))}
        </div>
        <div className="segmented">
          {(["az", "rating"] as const).map((s) => (
            <div key={s} className={`seg ${sort === s ? "seg-active" : ""}`} onClick={() => setSort(s)}>
              {s === "az" ? "A–Z" : "Top rated"}
            </div>
          ))}
        </div>
      </div>

      {f === "caughtup" && (
        <p className="dim" style={{ fontSize: 13.5, margin: "-8px 0 0" }}>
          Watched everything that's aired — just waiting on the next season.
        </p>
      )}

      {!isPending && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            Nothing here yet — hit <kbd className="mq-kbd">⌘K</kbd> and add a show.
          </p>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((s) => (
          <div key={s.title_id} className="flex flex-col gap-1.5">
            <Poster t={toTitleCard(s)} onClick={() => open(s.tmdb_id)} />
            {s.status === "caughtup" && s.next_air_datetime && (
              <div className="mute" style={{ fontSize: 11.5, paddingLeft: 2 }}>
                ⏳ Next episode {new Date(s.next_air_datetime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
