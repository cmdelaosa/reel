import { useParams, useSearchParams, Link } from "react-router";
import { ChevronLeft } from "lucide-react";
import { useCollection } from "@/lib/collections";
import { useFollow, useUnfollow, useLibrary } from "@/lib/library";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { Check, Plus } from "lucide-react";
import { posterBg } from "@/ui/posterBg";

export default function CollectionPage() {
  const { slug } = useParams();
  const { data, isPending } = useCollection(slug);
  const [, setSearchParams] = useSearchParams();

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <Link to="/explore" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
        <ChevronLeft size={15} />Explore
      </Link>
      <header className="mq-header">
        <h1 className="mq-h1">{data?.collection.name ?? "Collection"}</h1>
        <p className="dim mq-sub">{data?.collection.sub ?? (isPending ? "Loading…" : "")}</p>
      </header>

      {!isPending && data && data.titles.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>Nothing here yet.</p>
        </div>
      )}

      <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
        {(data?.titles ?? []).map((t) => (
          <div key={t.tmdb_id} className="flex flex-col gap-1.5">
            <CollectionPoster t={t} onOpen={() => open(t.tmdb_id)} />
            <AddButton t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectionPoster({ t, onOpen }: { t: TitleRow; onOpen: () => void }) {
  const art = tmdbImg(t.poster_path);
  return (
    <div className="poster" style={{ background: posterBg(t.name) }} onClick={onOpen}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
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
