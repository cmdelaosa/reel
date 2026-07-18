import { t as tr } from "@/lib/i18n";
import { DiscoverSections } from "@/features/explore/DiscoverSections";
import { CollectionsSection } from "@/features/explore/CollectionsSection";

/* Explore — trending + a tabbed discover section (Popular now / Top rated /
   With friends) and collections. The friend sections (activity, best rated by
   friends) live on the Friends tab. */

export default function ExplorePage() {
  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Explore")}</h1>

      <DiscoverSections />

      <CollectionsSection />
    </div>
  );
}
