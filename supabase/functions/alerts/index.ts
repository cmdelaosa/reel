// alerts — scheduled edge function (P3-C2), runs daily after episode-refresh.
//
// For every episode of a followed show that aired in the last 24h and hasn't
// been notified to that follower yet: insert one `notifications` inbox row
// (respecting notification_prefs.inapp, default on) and record it in
// `notifications_sent` so repeated runs are idempotent. Users whose
// notification_prefs.email is on for `new_episode` get ONE digest email per run
// via Resend (skipped with a log if RESEND_API_KEY is absent).
//
// AUTH: headless — requires the service-role bearer.
// SCHEDULE: pg_cron daily (a bit after episode-refresh), same pattern as that
// function's header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

interface Pending {
  user_id: string;
  episode_id: string;
  title_id: string;
  tmdb_id: number;
  show_name: string;
  season_number: number;
  episode_number: number;
  episode_name: string | null;
}

const EMAIL_FROM = "Reel <onboarding@resend.dev>"; // replace with a verified sender once a domain is set

function digestHtml(rows: Pending[]): string {
  const items = rows
    .map(
      (r) =>
        `<li><strong>${r.show_name}</strong> — S${r.season_number} · E${r.episode_number}${r.episode_name ? ` “${r.episode_name}”` : ""}</li>`,
    )
    .join("");
  return `<p>New episodes from shows you follow:</p><ul>${items}</ul><p>— Reel</p>`;
}

function digestText(rows: Pending[]): string {
  const items = rows
    .map((r) => `• ${r.show_name} — S${r.season_number}E${r.episode_number}${r.episode_name ? ` "${r.episode_name}"` : ""}`)
    .join("\n");
  return `New episodes from shows you follow:\n${items}\n\n— Reel`;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const resendKey = Deno.env.get("RESEND_API_KEY");

  const { data: pending, error } = await admin.rpc("pending_new_episode_alerts");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const rows = (pending ?? []) as Pending[];

  const report = { pending: rows.length, recorded: 0, inappInserted: 0, emailsSent: 0, emailSkipped: 0, users: 0 };
  if (rows.length === 0) return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  report.users = userIds.length;

  // prefs for new_episode (absent row → inapp on, email off)
  const { data: prefRows } = await admin
    .from("notification_prefs")
    .select("user_id, inapp, email")
    .eq("type", "new_episode")
    .in("user_id", userIds);
  const prefs = new Map((prefRows ?? []).map((p: Any) => [p.user_id, p]));
  const inappOn = (uid: string) => prefs.get(uid)?.inapp ?? true;
  const emailOn = (uid: string) => prefs.get(uid)?.email ?? false;

  // ── Atomic dedupe: record the ledger FIRST, alert only what it accepted.
  // ON CONFLICT DO NOTHING … RETURNING (ignoreDuplicates + select) hands back
  // only the (user, episode) pairs this run actually inserted. So a retry after
  // a mid-run crash (ledger written, notifications not) won't re-alert, and two
  // concurrent runs can't both claim the same pair. The ledger is the source of
  // truth; in-app rows and emails are derived from what it accepted.
  const { data: recorded, error: se } = await admin
    .from("notifications_sent")
    .upsert(
      rows.map((r) => ({ user_id: r.user_id, episode_id: r.episode_id })),
      { onConflict: "user_id,episode_id", ignoreDuplicates: true },
    )
    .select("user_id, episode_id");
  if (se) return new Response(JSON.stringify({ error: se.message }), { status: 500 });

  const fresh = new Set((recorded ?? []).map((r: Any) => `${r.user_id}:${r.episode_id}`));
  const freshRows = rows.filter((r) => fresh.has(`${r.user_id}:${r.episode_id}`));
  report.recorded = freshRows.length;
  if (freshRows.length === 0) {
    return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
  }

  // in-app notifications for opted-in recipients (only the freshly-recorded rows)
  const notifRows = freshRows
    .filter((r) => inappOn(r.user_id))
    .map((r) => ({
      user_id: r.user_id,
      type: "new_episode",
      payload: {
        tmdb_id: r.tmdb_id,
        show_name: r.show_name,
        season_number: r.season_number,
        episode_number: r.episode_number,
        episode_name: r.episode_name,
      },
    }));
  if (notifRows.length) {
    const { error: ne } = await admin.from("notifications").insert(notifRows);
    if (ne) return new Response(JSON.stringify({ error: ne.message }), { status: 500 });
    report.inappInserted = notifRows.length;
  }

  // one digest email per opted-in recipient with fresh episodes. Resolve each
  // address individually — listUsers() returns only the first page, silently
  // dropping recipients past it.
  const emailUsers = [...new Set(freshRows.map((r) => r.user_id))].filter(emailOn);
  if (emailUsers.length > 0) {
    if (!resendKey) {
      report.emailSkipped = emailUsers.length; // coded; pending RESEND_API_KEY
    } else {
      for (const uid of emailUsers) {
        const { data: authUser } = await admin.auth.admin.getUserById(uid);
        const to = authUser?.user?.email;
        if (!to) continue;
        const mine = freshRows.filter((r) => r.user_id === uid);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to,
            subject: `${mine.length} new ${mine.length === 1 ? "episode" : "episodes"} from your shows`,
            html: digestHtml(mine),
            text: digestText(mine),
          }),
        });
        if (res.ok) report.emailsSent++;
      }
    }
  }

  return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
});
