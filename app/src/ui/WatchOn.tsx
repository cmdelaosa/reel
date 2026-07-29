/* ---- Where to watch, in the viewer's country ----
   Replaces the show's original broadcast network everywhere the question is
   "what do I put this on with" — posters, calendar rows, the detail header.
   `titles.network` is still the right answer for "what kind of show is this"
   and still drives the profile's top-networks stat.

   Renders nothing when the title has no subscription provider in this country.
   That blank is deliberate: it means "not available to you here", which is
   more useful than the US network that used to sit there.

   Drawn with ProviderLogo, which keeps the bundled Netflix/Apple/Disney
   vectors (the ingest canonicalises provider names onto those spellings for
   exactly that) but renders everything else as the square app icon TMDB
   actually ships. */
import { useProviders } from "@/lib/providers";
import { ProviderLogo } from "@/ui/NetworkLogo";
import { tv } from "@/lib/i18n";

export function WatchOn({ tmdbId, size = 11, max = 3 }: {
  tmdbId: number | null | undefined;
  size?: number;
  /* Three fits the poster's badge row at 11px without crowding the rating on
     the other side. Wordmark tiles are variable-width, so they sit in a tight
     row rather than an overlapping stack — overlapping would bury the very
     wordmarks that identify them. */
  max?: number;
}) {
  const { data } = useProviders(tmdbId);
  if (!data?.length) return null;

  const shown = data.slice(0, max);
  return (
    // role="img": aria-label is ignored on a bare span (role generic is
    // skipped by the accessible-name computation), and the role also makes the
    // subtree presentational, so the stack is announced once as a group
    // instead of once per logo's alt text.
    <span
      role="img"
      style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "0 0 auto", minWidth: 0 }}
      aria-label={tv("Available on {providers}", { providers: shown.map((p) => p.name).join(", ") })}
    >
      {shown.map((p) => (
        <ProviderLogo key={p.name} name={p.name} logoPath={p.logoPath} size={size} />
      ))}
    </span>
  );
}
