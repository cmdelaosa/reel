import { useState } from "react";
import { useSearchParams } from "react-router";
import { useLibrary, toTitleCard, type LibraryShow } from "@/lib/library";
import type { ShowStatus } from "@/domain/status";
import { t as tr, tv } from "@/lib/i18n";
import { fmtAirDate } from "@/lib/region";
import { Poster, TabMenu } from "@/ui";
import { PosterGridSkeleton } from "@/ui/Skeleton";

/* My Shows — the library grid with status buckets. Port of prototype
   marquee.tsx → Shows, on live data. */

type Bucket = ShowStatus | "all" | "stopped";
const FILTERS: { key: Bucket; label: string }[] = [
  { key: "watching", label: "Watching" },
  { key: "caughtup", label: "Caught up" },
  { key: "watchlist", label: "Not started" },
  { key: "upcoming", label: "Upcoming" },
  { key: "finished", label: "Finished" },
  { key: "stopped", label: "Stopped" },
  { key: "all", label: "All" },
];

type SortKey = "lastwatched" | "lastreleased" | "az" | "rating";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "lastwatched", label: "Last watched" },
  { key: "lastreleased", label: "Last released" },
  { key: "az", label: "A–Z" },
  { key: "rating", label: "Top rated" },
];
/* "Last watched" is the page's default everywhere except Not started, where by
   definition nothing has been watched: every row's key is null, so the order was
   whatever the rollup happened to return. What you want from a pile of shows you
   haven't begun is the newest one, so that bucket opens on Last released. Only a
   default — pick a sort and it holds while you move between buckets. */
const DEFAULT_SORT: Partial<Record<Bucket, SortKey>> = { watchlist: "lastreleased" };
const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
const COMPARATORS: Record<SortKey, (a: LibraryShow, b: LibraryShow) => number> = {
  lastwatched: (a, b) => ms(b.last_watched_at) - ms(a.last_watched_at),
  lastreleased: (a, b) => ms(b.last_aired_datetime) - ms(a.last_aired_datetime),
  az: (a, b) => a.name.localeCompare(b.name),
  rating: (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
};

export default function ShowsPage() {
  const { data: library = [], isPending } = useLibrary();
  // Null until you touch the sort strip; until then the bucket chooses.
  const [sortPick, setSortPick] = useState<SortKey | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  /* The bucket lives in the URL, not in state: the Watchlist tab links straight
     to ?filter=watchlist, and from /shows itself that's a same-route navigation
     — local state would simply ignore it. Unknown or absent falls back to
     Watching, the bucket this page has always opened on.
     Picking a chip replaces the entry rather than pushing one: filtering isn't
     navigation, and Back should leave the page, not walk back through six
     buckets. */
  const param = searchParams.get("filter");
  const f: Bucket = FILTERS.some((x) => x.key === param) ? (param as Bucket) : "watching";
  const setF = (key: Bucket) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", key);
        return next;
      },
      { replace: true },
    );
  const sort: SortKey = sortPick ?? DEFAULT_SORT[f] ?? "lastwatched";

  // All includes every follow (stopped too); the status buckets show active
  // follows only, and Stopped collects the stopped ones.
  const inBucket = (s: LibraryShow) => {
    if (f === "all") return true;
    if (f === "stopped") return s.stopped;
    if (s.stopped) return false;
    return s.status === f;
  };
  const count = (key: Bucket) =>
    key === "all"
      ? library.length
      : key === "stopped"
        ? library.filter((s) => s.stopped).length
        : library.filter((s) => !s.stopped && s.status === key).length;
  const items = library.filter(inBucket).sort(COMPARATORS[sort]);

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("My Shows")}</h1>

      <div className="mq-toolbar">
        <div className="shows-buckets flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ flex: 1 }}>
          {FILTERS.map((x) => (
            <button key={x.key} className={`chip ${f === x.key ? "chip-active" : ""}`} onClick={() => setF(x.key)}>
              {tr(x.label)}
              <span className="mute" style={{ fontWeight: 700 }}>{count(x.key)}</span>
            </button>
          ))}
        </div>
        {/* Same options on a phone, as a menu — the chip row scrolled seven wide
            and showed two. Counts ride along as hints so the menu says as much
            as the row does. */}
        <TabMenu
          value={f}
          options={FILTERS.map((x) => ({ key: x.key, label: tr(x.label), hint: String(count(x.key)) }))}
          onPick={setF}
          menuLabel={tr("My Shows")}
        />
        <div className="segmented scroll no-scrollbar">
          {SORTS.map((s) => (
            <div key={s.key} className={`seg ${sort === s.key ? "seg-active" : ""}`} onClick={() => setSortPick(s.key)}>
              {tr(s.label)}
            </div>
          ))}
        </div>
        {/* Phone shape of the same strip — "Mejor nota" showed 58 of its 95px at
            360px, with nothing saying a fourth sort existed. */}
        <TabMenu
          value={sort}
          options={SORTS.map((s) => ({ key: s.key, label: tr(s.label) }))}
          onPick={setSortPick}
          menuLabel={tr("Sort")}
          align="end"
        />
      </div>

      {f === "caughtup" && (
        <p className="dim" style={{ fontSize: 13.5, margin: "-8px 0 0" }}>
          {tr("Watched everything that's aired — just waiting on the next season.")}
        </p>
      )}

      {isPending && <PosterGridSkeleton />}

      {!isPending && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {/* One key for the sentence; the ⌘K chip is slotted back wherever
                the translation puts {key}, so it isn't pinned to English order. */}
            {f === "all"
              ? tr("Nothing here yet — hit {key} and add a show.")
                  .split("{key}")
                  .flatMap((part, i) => (i === 0 ? [part] : [<kbd key={i} className="mq-kbd">⌘K</kbd>, part]))
              : tv("Nothing in {filter} right now.", { filter: tr(FILTERS.find((x) => x.key === f)?.label ?? "") })}
          </p>
        </div>
      )}

      <div className="poster-grid">
        {items.map((s) => (
          <div key={s.title_id} className="flex flex-col gap-1.5">
            <Poster t={toTitleCard(s)} prefetchTmdbId={s.tmdb_id} onClick={() => open(s.tmdb_id)} />
            {s.status === "caughtup" && s.next_air_datetime && (
              <div className="mute" style={{ fontSize: 11.5, paddingLeft: 2 }}>
                ⏳ {tr("Next episode")} {fmtAirDate(s.next_air_datetime)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
