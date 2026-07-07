import { useNavigate } from "react-router";
import { useCollections } from "@/lib/collections";

/* Explore collection tiles — 16:9 gradient cards → /collection/:slug. */
export function CollectionsSection() {
  const { data: collections = [] } = useCollections();
  const navigate = useNavigate();

  if (collections.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">Collections</h2>
          <p className="mute" style={{ fontSize: 13 }}>Hand-picked corners to dig into</p>
        </div>
      </div>
      <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {collections.map((c) => (
          <button
            key={c.id}
            onClick={() => navigate(`/collection/${c.slug}`)}
            className="card"
            style={{
              aspectRatio: "16 / 9", padding: 18, textAlign: "left", cursor: "pointer",
              display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden",
              border: "1px solid var(--border)",
              background: `linear-gradient(135deg, hsl(${c.hue} 55% 32%), hsl(${(c.hue + 45) % 360} 60% 16%))`,
              color: "#fff",
            }}
          >
            <div className="poster-sheen" />
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>{c.name}</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)" }}>{c.sub}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
