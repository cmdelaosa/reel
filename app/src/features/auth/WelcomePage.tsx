import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { isPlaceholderHandle } from "@/lib/schemas";
import { getSettings, setSetting } from "@/lib/settings";
import { COUNTRIES, countryName } from "@/lib/region";
import { Logo } from "@/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { cropAvatar } from "@/features/auth/avatar";

const handleSchema = z
  .string()
  .regex(/^[a-z0-9_.]{3,24}$/, "3–24 chars: a–z, 0–9, dots or underscores.");

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

type HandleState =
  | { kind: "idle" }
  | { kind: "invalid"; msg: string }
  | { kind: "checking" }
  | { kind: "taken" }
  | { kind: "free" };

export default function WelcomePage() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(
    profile && profile.display_name !== "New user" ? profile.display_name : "",
  );
  const [handle, setHandle] = useState("");
  // Seeded from the device's timezone, then owned by the viewer — it decides
  // which country's streaming providers Reel shows and what clock airing times
  // are in, so it is asked once here rather than guessed forever.
  const [country, setCountry] = useState(getSettings().country);
  const [handleState, setHandleState] = useState<HandleState>({ kind: "idle" });
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Onboarding is once-only: already-onboarded users go straight in.
  if (profile && !isPlaceholderHandle(profile.handle)) {
    return <Navigate to="/tonight" replace />;
  }

  const checkHandle = async () => {
    const parsed = handleSchema.safeParse(handle);
    if (!parsed.success) {
      if (handle) setHandleState({ kind: "invalid", msg: parsed.error.issues[0].message });
      return;
    }
    setHandleState({ kind: "checking" });
    const { data, error } = await supabase.rpc("handle_available", { p_handle: handle });
    if (error) setHandleState({ kind: "idle" }); // soft-fail; submit re-validates
    else setHandleState(data ? { kind: "free" } : { kind: "taken" });
  };

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await cropAvatar(file);
      setAvatarBlob(blob);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(URL.createObjectURL(blob));
    } catch {
      setError("Couldn't read that image — try another file.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const parsed = handleSchema.safeParse(handle);
    if (!parsed.success) {
      setHandleState({ kind: "invalid", msg: parsed.error.issues[0].message });
      return;
    }
    setBusy(true);
    setError(null);

    try {
      let avatar_url: string | undefined;
      if (avatarBlob) {
        const path = `${session.user.id}/avatar.png`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, avatarBlob, { upsert: true, contentType: "image/png" });
        if (upErr) throw new Error(`Avatar upload failed: ${upErr.message}`);
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        avatar_url = data.publicUrl;
      }

      const { error: updErr } = await supabase
        .from("profiles")
        .update({
          handle,
          display_name: displayName.trim(),
          ...(avatar_url ? { avatar_url } : {}),
        })
        .eq("id", session.user.id);

      if (updErr) {
        if (updErr.code === "23505") {
          setHandleState({ kind: "taken" });
          throw new Error("That handle just got taken — pick another.");
        }
        throw new Error(updErr.message);
      }

      // Local, like the rest of the appearance settings — it describes this
      // device's viewer, not the profile friends see.
      setSetting("country", country);

      await queryClient.invalidateQueries({ queryKey: ["profile", session.user.id] });
      navigate("/tonight", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleHint = {
    idle: null,
    checking: <span className="mute" style={{ fontSize: 12.5 }}>Checking…</span>,
    invalid: null,
    taken: (
      <span role="alert" style={{ color: "#e5484d", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <X size={13} /> @{handle} is taken
      </span>
    ),
    free: (
      <span style={{ color: "var(--accent)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Check size={13} /> @{handle} is yours
      </span>
    ),
  }[handleState.kind];

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card sheet" style={{ width: "min(440px, 92vw)", padding: "34px 30px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <Logo />
        </div>
        <h1 className="section-title" style={{ margin: 0, textAlign: "center" }}>Set up your profile</h1>
        <p className="dim" style={{ fontSize: 13.5, textAlign: "center", margin: "6px 0 24px" }}>
          How you'll show up to friends. You can change all of this later.
        </p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Choose an avatar"
              style={{
                width: 88, height: 88, borderRadius: "var(--r-lg)", cursor: "pointer",
                border: "2px dashed var(--border-strong)", background: "var(--surface-2)",
                display: "grid", placeItems: "center", overflow: "hidden", padding: 0,
              }}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span className="dim" style={{ display: "grid", placeItems: "center", gap: 4, fontSize: 11.5 }}>
                  <Camera size={20} />
                  Optional
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="eyebrow">Display name</span>
            <input
              style={field}
              required
              maxLength={50}
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="eyebrow">Handle</span>
            <div style={{ position: "relative" }}>
              <span className="mute" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 15 }}>@</span>
              <input
                style={{ ...field, paddingLeft: 32 }}
                required
                placeholder="handle"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value.toLowerCase());
                  setHandleState({ kind: "idle" });
                }}
                onBlur={checkHandle}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div style={{ minHeight: 18 }}>
              {handleState.kind === "invalid" ? (
                <span role="alert" style={{ color: "#e5484d", fontSize: 12.5 }}>{handleState.msg}</span>
              ) : (
                handleHint
              )}
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="eyebrow">Where you watch</span>
            <select
              style={{ ...field, appearance: "auto" }}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{countryName(c)}</option>
              ))}
            </select>
            <span className="mute" style={{ fontSize: 12.5 }}>
              Sets which streaming services we show for each series, and the timezone airing times use.
            </span>
          </label>

          <button
            className="btn btn-accent"
            type="submit"
            disabled={busy || !displayName.trim() || !handle || handleState.kind === "taken"}
          >
            {busy ? "Saving…" : "All set — take me in"}
          </button>
        </form>

        {error && (
          <p role="alert" style={{ color: "#e5484d", fontSize: 13, marginTop: 14, textAlign: "center" }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
