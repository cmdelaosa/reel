import { useState } from "react";
import { useSearchParams } from "react-router";
import { useLibrary, toTitleCard, type LibraryShow } from "@/lib/library";
import type { ShowStatus } from "@/domain/status";
import { dateLocale, isEs, t as tr } from "@/lib/i18n";
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
const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
const COMPARATORS: Record<SortKey, (a: LibraryShow, b: LibraryShow) => number> = {
  lastwatched: (a, b) => ms(b.last_watched_at) - ms(a.last_watched_at),
  lastreleased: (a, b) => ms(b.last_aired_datetime) - ms(a.last_aired_datetime),
  az: (a, b) => a.name.localeCompare(b.name),
  rating: (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
};

export default function ShowsPage() {
  const { data: library = [], isPending } = useLibrary();
  const [f, setF] = useState<Bucket>("watching");
  const [sort, setSort] = useState<SortKey>("lastwatched");
  const [, setSearchParams] = useSearchParams();

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
            <div key={s.key} className={`seg ${sort === s.key ? "seg-active" : ""}`} onClick={() => setSort(s.key)}>
              {tr(s.label)}
            </div>
          ))}
        </div>
        {/* Phone shape of the same strip — "Mejor nota" showed 58 of its 95px at
            360px, with nothing saying a fourth sort existed. */}
        <TabMenu
          value={sort}
          options={SORTS.map((s) => ({ key: s.key, label: tr(s.label) }))}
          onPick={setSort}
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
            {f === "all"
              ? isEs()
                ? <>Aún no hay nada — pulsa <kbd className="mq-kbd">⌘K</kbd> y añade una serie.</>
                : <>Nothing here yet — hit <kbd className="mq-kbd">⌘K</kbd> and add a show.</>
              : isEs()
                ? `Nada en ${tr(FILTERS.find((x) => x.key === f)?.label ?? "")} ahora mismo.`
                : `Nothing in ${FILTERS.find((x) => x.key === f)?.label} right now.`}
          </p>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))", gap: "var(--gap)" }}>
        {items.map((s) => (
          <div key={s.title_id} className="flex flex-col gap-1.5">
            <Poster t={toTitleCard(s)} prefetchTmdbId={s.tmdb_id} onClick={() => open(s.tmdb_id)} />
            {s.status === "caughtup" && s.next_air_datetime && (
              <div className="mute" style={{ fontSize: 11.5, paddingLeft: 2 }}>
                ⏳ {tr("Next episode")} {new Date(s.next_air_datetime).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
