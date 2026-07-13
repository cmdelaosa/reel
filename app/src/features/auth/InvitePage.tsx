import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clearStashedInvite, readStashedInvite } from "@/lib/invites";
import { Logo } from "@/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { invitedQueryKey, useInvited } from "@/features/auth/invited";

const field: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "var(--r)",
  border: "1px solid var(--border-strong)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontSize: 15,
  fontFamily: "var(--font)",
  outline: "none",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  textAlign: "center",
};

export default function InvitePage() {
  const { session, signOut } = useAuth();
  const { data: invited } = useInvited();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(() => readStashedInvite() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already through the gate (incl. arriving here by URL) → into the app.
  if (invited) return <Navigate to="/" replace />;

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("redeem_invite", { p_code: code.trim() });
    setBusy(false);
    if (error) {
      setError(
        error.message.includes("invalid or expired")
          ? "That code isn't valid (or already used). Check it and try again."
          : error.message,
      );
      return;
    }
    clearStashedInvite();
    if (session) queryClient.setQueryData(invitedQueryKey(session.user.id), true);
    navigate("/", { replace: true }); // → onboarding (RequireOnboarded) or the app
  };

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card sheet" style={{ width: "min(400px, 92vw)", padding: "34px 30px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo />
        </div>

        <div
          className="grid place-items-center"
          style={{
            width: 52, height: 52, margin: "0 auto 14px", borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 16%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Ticket size={26} />
        </div>
        <h1 className="section-title" style={{ margin: 0, textAlign: "center" }}>
          Got an invite?
        </h1>
        <p className="dim" style={{ fontSize: 13.5, textAlign: "center", margin: "6px 0 22px" }}>
          Reel is invite-only for now. Enter the code a friend shared with you.
        </p>

        <form onSubmit={redeem} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            style={field}
            required
            placeholder="INVITE CODE"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-accent" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Redeem invite"}
          </button>
        </form>

        {error && (
          <p role="alert" style={{ color: "#e5484d", fontSize: 13, marginTop: 14, textAlign: "center" }}>
            {error}
          </p>
        )}

        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out ({session?.user.email})
          </button>
        </div>
      </div>
    </main>
  );
}
