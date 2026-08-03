// friend-request-email — event-driven edge function.
//
// Sends ONE email when someone adds you, for users who turned the Email chip on
// for `friend_request` in Settings. Fired by the notify_friend_request trigger
// through pg_net (migration 0061), not by a schedule: an email about a friend
// request is only worth anything while the request is news, and the daily
// `alerts` run would deliver it up to 24h after the in-app notification the
// person already saw.
//
// The in-app notification is NOT written here — the trigger owns that, under
// its own `inapp` preference. The two channels are independent: Email on with
// App off is a legitimate combination and must still send.
//
// AUTH: headless — requires the service-role bearer, which pg_net reads from
// Vault. Nothing user-facing calls this.
//
// Body: { user_id, from_handle, from_name }
//
// SENDER: RESEND_FROM must be a verified-domain address (see alerts/index.ts
// for why resend.dev's shared sender is not a usable fallback). Unset → the
// send is skipped and recorded, never sent from an address nobody receives.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMAIL_FROM = Deno.env.get("RESEND_FROM");

/** Whoever sent the request, as the recipient should read it: their display
 *  name if we have one, their @handle otherwise, and a neutral noun if the
 *  profile row somehow gave us neither. */
function requesterLabel(name: string | null, handle: string | null): string {
  if (name && handle) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : "Someone");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const resendKey = Deno.env.get("RESEND_API_KEY");

  // pg_net discards the response body (migration 0029's whole reason for
  // existing), so a row per outcome here is the only way a silently failing
  // mailer is ever visible. Best-effort — never fail the send on the log.
  const startedAt = new Date().toISOString();
  const logRun = (ok: boolean, summary: unknown) =>
    admin.from("job_runs").insert({
      job: "friend-request-email",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok,
      summary,
    }).then(() => {}, () => {});

  const done = async (ok: boolean, summary: Record<string, unknown>, status = 200) => {
    await logRun(ok, summary);
    return new Response(JSON.stringify(summary), { status, headers: { "content-type": "application/json" } });
  };

  let body: { user_id?: string; from_handle?: string | null; from_name?: string | null };
  try {
    body = await req.json();
  } catch {
    return done(false, { error: "invalid json" }, 400);
  }
  const userId = body.user_id;
  if (!userId) return done(false, { error: "user_id required" }, 400);

  // Re-read the preference rather than trusting the caller. pg_net is
  // asynchronous, so the toggle can have been turned off between the trigger
  // firing and this running — and the answer here is the one that matters.
  //
  // ABSENT ROW = ON, and only for this type. A row is written lazily, on the
  // first toggle, so most users have none at all and this branch is the one
  // that decides whether they are mailed. It mirrors
  // NOTIFICATION_TYPES.defaults in app/src/lib/notificationPrefs.ts (friend
  // requests default to email on; new_episode does not) and the same coalesce
  // in 0063's trigger. All three move together or someone is silently mailed,
  // or silently isn't.
  const { data: pref, error: pe } = await admin
    .from("notification_prefs")
    .select("email")
    .eq("user_id", userId)
    .eq("type", "friend_request")
    .maybeSingle();
  if (pe) return done(false, { error: pe.message }, 500);
  if (!(pref?.email ?? true)) return done(true, { skipped: "email off" });

  if (!resendKey || !EMAIL_FROM) return done(true, { skipped: "no sender configured" });

  const { data: authUser, error: ae } = await admin.auth.admin.getUserById(userId);
  if (ae) return done(false, { error: ae.message }, 500);
  const to = authUser?.user?.email;
  if (!to) return done(true, { skipped: "no address on file" });

  const who = requesterLabel(body.from_name ?? null, body.from_handle ?? null);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject: `${who} added you on Reel`,
      html: `<p><strong>${escapeHtml(who)}</strong> wants to be friends on Reel.</p>` +
        `<p>Open the app to accept or ignore the request.</p><p>— Reel</p>`,
      text: `${who} wants to be friends on Reel.\nOpen the app to accept or ignore the request.\n\n— Reel`,
    }),
  });
  if (!res.ok) {
    // Surfaced in job_runs instead of swallowed — same contract as alerts.
    return done(false, { sent: 0, status: res.status, detail: await res.text() }, 502);
  }
  return done(true, { sent: 1 });
});
