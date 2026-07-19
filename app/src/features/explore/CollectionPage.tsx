import { useParams, useSearchParams, Link } from "react-router";
import { ChevronLeft, EyeOff } from "lucide-react";
import { useCollection } from "@/lib/collections";
import { useFollow, useUnfollow, useLibrary } from "@/lib/library";
import { useIgnore, useIgnored } from "@/lib/ignore";
import type { TitleRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { Check, Plus } from "lucide-react";
import { posterBg } from "@/ui/posterBg";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { isEs, locName, t as tr, tGenre, useEsNames } from "@/lib/i18n";

export default function CollectionPage() {
  const { slug } = useParams();
  const { data, isPending } = useCollection(slug);
  const { data: library = [] } = useLibrary();
  const { isIgnored } = useIgnored();
  const ignore = useIgnore();
  const [, setSearchParams] = useSearchParams();
  // Only surface discoveries: drop what you already follow or have hidden.
  const followed = new Set(library.map((r) => r.tmdb_id));
  const titles = (data?.titles ?? []).filter((t) => !isIgnored(t.tmdb_id) && !followed.has(t.tmdb_id));

  const open = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });

  return (
    <div className="screen mq-page">
      <Link to="/explore" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
        <ChevronLeft size={15} />{tr("Explore")}
      </Link>
      <header className="mq-header">
        <h1 className="mq-h1">{data?.collection.name ?? (isEs() ? "Colección" : "Collection")}</h1>
      </header>

      {!isPending && data && titles.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {data.titles.length > 0
              ? (isEs() ? "Ya sigues (u ocultaste) todo lo de aquí." : "You already follow (or hid) everything here.")
              : (isEs() ? "Aún no hay nada aquí." : "Nothing here yet.")}
          </p>
        </div>
      )}

      <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
        {titles.map((t) => (
          <div key={t.tmdb_id} className="flex flex-col gap-1.5">
            <CollectionPoster t={t} onOpen={() => open(t.tmdb_id)} onIgnore={() => ignore.mutate(t.id)} />
            <AddButton t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectionPoster({ t, onOpen, onIgnore }: { t: TitleRow; onOpen: () => void; onIgnore: () => void }) {
  const art = tmdbImg(t.poster_path);
  const intent = useTitleIntent(t.tmdb_id);
  const esNames = useEsNames();
  const name = (isEs() && t.name_es) || locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="poster" style={{ background: posterBg(name) }} onClick={onOpen} {...intent}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      <button
        className="btn btn-icon badge-glass absolute"
        style={{ top: 8, right: 8, color: "#fff" }}
        title={tr("Ignore — hide from suggestions")}
        aria-label={`Hide ${name} from suggestions`}
        onClick={(e) => { e.stopPropagation(); onIgnore(); }}
      >
        <EyeOff size={15} />
      </button>
      <div className="poster-body">
        <div className="poster-title">{name}</div>
        <div className="poster-sub">{[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? "")].filter(Boolean).join(" · ")}</div>
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
      {added ? <><Check size={14} />{tr("Added")}</> : <><Plus size={14} />{tr("Add")}</>}
    </button>
  );
}
