import { useAuth } from "@/features/auth/AuthProvider";

/* Temporary signed-in landing — replaced by the Marquee shell in P1-C3. */
export default function App() {
  const { session, profile, signOut } = useAuth();

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font)",
      }}
    >
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          Reel — scaffold OK
        </h1>
        <p className="dim" style={{ margin: 0, fontSize: 14 }}>
          Signed in as {profile?.display_name ?? session?.user.email}
        </p>
        <button className="btn btn-outline" style={{ margin: "0 auto" }} onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}
