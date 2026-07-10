import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";

/* name → TMDB logo_path map for streaming networks (public.network_logos, filled
   by the tmdb-proxy / episode-refresh / importer whenever a show carries network
   art). NetworkLogo reads this to render the official brand image for any
   platform instead of a two-letter monogram. */

const rowSchema = z.object({
  name: z.string(),
  logo_path: z.string().nullable(),
  logo_dark: z.boolean().nullable(),
});

export type NetworkLogo = { path: string; dark: boolean };
export type NetworkLogoMap = Map<string, NetworkLogo>; // name → logo (art only)

/* Manual overrides: networks the automatic brightness measure misjudges (mixed
   or thin logos that still read poorly on a dark tile). Listed here → always
   treated as dark, i.e. given the light tile. */
const FORCE_LIGHT_TILE = new Set(["HBO Max", "NBC"]);

/** Whole network_logos table as a name→logo map. Cached for the session (logos
    are effectively static), so every NetworkLogo shares one fetch. `dark` is
    true when the brand art is dark-on-transparent and needs a light tile;
    unmeasured logos (logo_dark null) default to dark=true (light tile) since the
    large majority of network logos are dark wordmarks. */
export function useNetworkLogos() {
  return useQuery({
    queryKey: qk.networkLogos,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<NetworkLogoMap> => {
      const { data, error } = await supabase.from("network_logos").select("name, logo_path, logo_dark");
      if (error) throw error;
      const rows = z.array(rowSchema).parse(data ?? []);
      return new Map(
        rows.filter((r) => r.logo_path).map((r) => [r.name, { path: r.logo_path as string, dark: FORCE_LIGHT_TILE.has(r.name) || r.logo_dark !== false }]),
      );
    },
  });
}
