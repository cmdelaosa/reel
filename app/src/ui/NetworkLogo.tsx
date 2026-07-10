/* ---- Network brand marks ----
   Netflix / Apple TV+ / Disney+ ship as polished bundled vectors (Wikimedia
   Commons SVGs from /public/logos) and are always preferred. Every other
   platform renders its official TMDB brand logo (network_logos cache, via
   useNetworkLogos). The CSS wordmark stand-ins / two-letter monogram remain only
   as a fallback for networks whose art hasn't been cached yet. */
import { useNetworkLogos, type NetworkLogo as NetworkLogoArt } from "@/lib/networkLogos";
import { tmdbImg } from "@/lib/tmdb";

function NetTile({ title, bg, pad = 7, size, children }: {
  title: string; bg: string; pad?: number; size: number; children: React.ReactNode;
}) {
  const h = size + 10;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
        height: h, minWidth: h, padding: `0 ${pad}px`, borderRadius: 6,
        background: bg, boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.09)", overflow: "hidden", flex: "0 0 auto",
      }}
    >
      {children}
    </span>
  );
}

function Wordmark({ text, size, color = "#fff", weight = 800 }: { text: string; size: number; color?: string; weight?: number }) {
  return (
    <span style={{ fontSize: size, fontWeight: weight, color, letterSpacing: "-0.03em", lineHeight: 1, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

/* Polished vectors we bundle ourselves — brand-correct backgrounds, always win
   over the generic TMDB art. Returns null for anything we don't ship. */
function ShippedMark({ network, size }: { network: string; size: number }): React.ReactElement | null {
  switch (network) {
    case "Netflix":
      return (
        <NetTile title="Netflix" bg="#000" pad={8} size={size}>
          <img src="/logos/netflix-n.svg" alt="Netflix" style={{ height: size + 6, display: "block" }} />
        </NetTile>
      );
    case "Apple TV+":
      /* Official app icon (self-contained dark tile). The layout box is the
         same height as the wordmark tiles so it aligns with the other marks;
         the larger square overflows it, centred, so the inner tv mark reads at
         the same vertical centre instead of sitting lower. */
      return (
        <span
          title="Apple TV+"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            height: size + 10, width: size + 21, flex: "0 0 auto", verticalAlign: "middle",
          }}
        >
          <img
            src="/logos/apple-tv.svg"
            alt="Apple TV+"
            style={{
              height: size + 21, width: size + 21, display: "block",
              borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          />
        </span>
      );
    case "Disney+":
      return (
        <NetTile title="Disney+" bg="linear-gradient(150deg,#0a2a46,#17b8c9)" pad={6} size={size}>
          <img src="/logos/disney-plus.svg" alt="Disney+" style={{ height: size + 5, display: "block", filter: "brightness(0) invert(1)" }} />
        </NetTile>
      );
    default:
      return null;
  }
}

/* Official brand image from TMDB (network_logos). Many network logos are
   dark-on-transparent (HBO, FX, AMC …) and vanish on a dark tile, so `dark`
   logos get a light tile and light/colored ones keep the dark tile. Height-
   constrained so wide and square logos share one baseline. */
function TmdbMark({ network, logo, size }: { network: string; logo: NetworkLogoArt; size: number }) {
  return (
    <NetTile title={network} bg={logo.dark ? "#dcdfe4" : "#0d0f13"} pad={7} size={size}>
      <img
        src={tmdbImg(logo.path, "w92")}
        alt={network}
        style={{ height: size + 2, maxWidth: (size + 2) * 4, objectFit: "contain", display: "block" }}
      />
    </NetTile>
  );
}

/* CSS stand-in used only until a network's TMDB art is cached. */
function StandIn({ network, size }: { network: string; size: number }): React.ReactElement {
  switch (network) {
    case "HBO":
      return <NetTile title="HBO" bg="#000" size={size}><Wordmark text="HBO" size={size} /></NetTile>;
    case "FX":
      return <NetTile title="FX" bg="#000" pad={8} size={size}><Wordmark text="FX" size={size + 1} /></NetTile>;
    case "AMC":
      return <NetTile title="AMC" bg="#000" size={size}><Wordmark text="AMC" size={size - 0.5} /></NetTile>;
    case "Prime Video":
      return (
        <NetTile title="Prime Video" bg="#1b2733" size={size}>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <Wordmark text="prime" size={size} />
            <svg width={size * 2.6} height={size * 0.5} viewBox="0 0 26 5" style={{ marginTop: 1, display: "block" }} aria-hidden>
              <path d="M1 1 C 9 5.5, 17 5.5, 25 1" fill="none" stroke="#00A8E1" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        </NetTile>
      );
    default:
      return <NetTile title={network} bg="#2b3242" size={size}><Wordmark text={network.slice(0, 2).toUpperCase()} size={size} color="#e9edf5" /></NetTile>;
  }
}

export function NetworkLogo({ network, size = 11 }: { network: string; size?: number }) {
  const { data: logos } = useNetworkLogos();

  const shipped = ShippedMark({ network, size });
  if (shipped) return shipped;

  const logo = logos?.get(network);
  if (logo) return <TmdbMark network={network} logo={logo} size={size} />;

  return <StandIn network={network} size={size} />;
}
