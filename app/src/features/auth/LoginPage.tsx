import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/ui";
import { useAuth } from "@/features/auth/AuthProvider";

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
};

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29v-3.1H1.29a12 12 0 0 0 0 10.78l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.29 6.61l4 3.1C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

export default function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or just completed the magic-link redirect) → onwards.
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const googleSignIn = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  };

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card sheet" style={{ width: "min(400px, 92vw)", padding: "34px 30px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo />
        </div>

        {sent ? (
          <div className="screen" style={{ textAlign: "center" }}>
            <div
              className="grid place-items-center"
              style={{
                width: 52, height: 52, margin: "0 auto 14px", borderRadius: 999,
                background: "color-mix(in srgb, var(--accent) 16%, transparent)",
                color: "var(--accent)",
              }}
            >
              <MailCheck size={26} />
            </div>
            <h1 className="section-title" style={{ margin: 0 }}>Check your inbox</h1>
            <p className="dim" style={{ fontSize: 14, marginTop: 8 }}>
              We sent a sign-in link to <strong>{email}</strong>. Open it on this device.
            </p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 18 }} onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 className="section-title" style={{ margin: 0, textAlign: "center" }}>Welcome back</h1>
            <p className="dim" style={{ fontSize: 13.5, textAlign: "center", margin: "6px 0 22px" }}>
              Track what you watch. Invite-only beta.
            </p>

            <form onSubmit={sendLink} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                style={field}
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <button className="btn btn-accent" type="submit" disabled={busy || !email}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span className="mute" style={{ fontSize: 12, fontWeight: 600 }}>or</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            <button className="btn btn-outline" style={{ width: "100%" }} onClick={googleSignIn}>
              <GoogleMark />
              Continue with Google
            </button>

            {error && (
              <p role="alert" style={{ color: "#e5484d", fontSize: 13, marginTop: 14, textAlign: "center" }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
