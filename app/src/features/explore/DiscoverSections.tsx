import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, Plus } from "lucide-react";
import { useTrending } from "@/lib/explore";
import { useLibrary, useFollow, useUnfollow } from "@/lib/library";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { Rail } from "@/ui";
import { posterBg } from "@/ui/posterBg";

/* Trending rail (ranked) + genre chips + "Not in your watchlist" discover grid.
   Port of prototype Explore trending/discover. */

function TitlePoster({ t, rank, onOpen }: { t: TitleRow; rank?: number; onOpen: () => void }) {
  const art = tmdbImg(t.poster_path);
  return (
    <div className="poster" style={{ background: posterBg(t.name) }} onClick={onOpen}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      {rank != null && <span className="mq-rank">{rank}</span>}
      <div className="poster-body">
        <div className="poster-title">{t.name}</div>
        <div className="poster-sub">{[t.first_air_date?.slice(0, 4), t.genres[0]].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

function AddButton({ t }: { t: TitleRow }) {
  const { data: library = [] } = useLibrary();
  const follow = useFollow();
  const unfollow = useUnfollow();
  const entry = library.find((r) => r.tmdb_id === t.tmdb_id);
  const added = Boolean(entry);
  return (
    <button
      className={`btn btn-sm ${added ? "btn-accent" : "btn-outline"}`}
      style={{ width: "100%" }}
      onClick={(e) => {
        e.stopPropagation();
        if (added && entry) unfollow.mutate(entry.title_id);
        else follow.mutate(t);
      }}
    >
      {added ? <><Check size={14} />Added</> : <><Plus size={14} />Add</>}
    </button>
  );
}

export function DiscoverSections() {
  const { data: trending = [] } = useTrending();
  const { data: library = [] } = useLibrary();
  const [genre, setGenre] = useState<string | null>(null);
  const [, setSearchParams] = useSearchParams();

  // Snapshot the followed set the first time trending loads, so a title just
  // Added stays in the grid (showing "Added") until you navigate — matching the
  // prototype's chosen behavior. (setState-in-render, converges once.)
  const [excluded, setExcluded] = useState<Set<number> | null>(null);
  if (excluded === null && trending.length > 0) {
    setExcluded(new Set(library.map((r) => r.tmdb_id)));
  }
  const discover = trending.filter((t) => !(excluded ?? new Set<number>()).has(t.tmdb_id));
  const genres = useMemo(
    () => [...new Set(discover.flatMap((t) => t.genres))].sort().slice(0, 12),
    [discover],
  );
  const filtered = genre ? discover.filter((t) => t.genres.includes(genre)) : discover;

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  if (trending.length === 0) return null;

  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="mq-sechead">
          <div>
            <h2 className="section-title">Trending this week</h2>
            <p className="mute" style={{ fontSize: 13 }}>What everyone's watching, via TMDB</p>
          </div>
        </div>
        <Rail>
          {trending.map((t, i) => (
            <div key={t.tmdb_id} style={{ width: "var(--rail-pw)" }}>
              <TitlePoster t={t} rank={i + 1} onOpen={() => open(t.tmdb_id)} />
            </div>
          ))}
        </Rail>
      </section>

      {discover.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="mq-sechead">
            <div>
              <h2 className="section-title">Not in your watchlist</h2>
              <p className="mute" style={{ fontSize: 13 }}>Trending shows you're not following yet</p>
            </div>
          </div>
          {genres.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button className={`chip ${genre === null ? "chip-active" : ""}`} onClick={() => setGenre(null)}>All</button>
              {genres.map((g) => (
                <button key={g} className={`chip ${genre === g ? "chip-active" : ""}`} onClick={() => setGenre(g)}>{g}</button>
              ))}
            </div>
          )}
          <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
            {filtered.map((t) => (
              <div key={t.tmdb_id} className="flex flex-col gap-1.5">
                <TitlePoster t={t} onOpen={() => open(t.tmdb_id)} />
                <AddButton t={t} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
