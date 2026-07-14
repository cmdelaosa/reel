import { Search } from "lucide-react";
import { DiscoverSections } from "@/features/explore/DiscoverSections";
import { CollectionsSection } from "@/features/explore/CollectionsSection";

/* Explore — trending + a tabbed discover section (Popular now / Top rated /
   With friends) and collections. The friend sections (activity, best rated by
   friends) live on the Friends tab. */

export default function ExplorePage() {
  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Explore</h1>
        <p className="dim mq-sub">Find your next show — starting with what your friends love.</p>
      </header>

      <button className="card mq-searchrow" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
        <Search size={18} className="mute" />
        <span className="mute">Search shows, genres, networks…</span>
        <kbd className="mq-kbd" style={{ marginLeft: "auto" }}>⌘K</kbd>
      </button>

      <DiscoverSections />

      <CollectionsSection />
    </div>
  );
}
