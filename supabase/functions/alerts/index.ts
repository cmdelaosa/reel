// alerts — scheduled edge function (P3-C2), runs daily after episode-refresh.
//
// Avisa de DOS cosas, cada una con su preferencia y sus palabras:
//
//   * un episodio nuevo de una serie que sigues (new_episode), y
//   * el estreno de una película que sigues (movie_release, 0071) — las dos
//     fechas avisan, la de cines y la de streaming, porque son dos momentos
//     distintos en los que puedes hacer dos cosas distintas.
//
// De cada fila avisable: una fila en `notifications` (respetando
// notification_prefs.inapp, por defecto encendida) y un sello en
// `notifications_sent` que hace idempotentes las corridas repetidas. Quien
// tenga el correo encendido recibe UN digest por corrida con lo suyo de los dos
// tipos, vía Resend (se salta con un log si falta RESEND_API_KEY).
//
// El sello lleva QUÉ se avisó desde 0071: una película tiene un solo episodio
// sintético y dos estrenos, así que sin esa tercera columna el aviso de
// streaming se perdía como duplicado del de cines.
//
// AUTH: headless — requires the service-role bearer.
// SCHEDULE: pg_cron daily (a bit after episode-refresh), same pattern as that
// function's header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Alertable, digestHtml, digestText, emailSubject } from "./digest.ts";

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

interface PendingMovie {
  user_id: string;
  episode_id: string;
  title_id: string;
  tmdb_id: number;
  movie_name: string;
  release_kind: "theatrical" | "digital";
  release_on: string;
}

const episodeAlertable = (r: Pending): Alertable => ({
  user_id: r.user_id,
  episode_id: r.episode_id,
  event: "episode",
  type: "new_episode",
  title: r.show_name,
  detail: `S${r.season_number} · E${r.episode_number}${r.episode_name ? ` “${r.episode_name}”` : ""}`,
  payload: {
    tmdb_id: r.tmdb_id,
    show_name: r.show_name,
    season_number: r.season_number,
    episode_number: r.episode_number,
    episode_name: r.episode_name,
  },
});

const movieAlertable = (r: PendingMovie): Alertable => ({
  user_id: r.user_id,
  episode_id: r.episode_id,
  event: r.release_kind,
  type: "movie_release",
  // Dos frases distintas, porque son dos cosas distintas que hacer: una te
  // manda al cine y la otra al sofá. Decir "ya está disponible" a las dos es
  // exactamente el error que 0069 se negó a cometer.
  title: r.movie_name,
  detail: r.release_kind === "theatrical" ? "in theatres today" : "streaming today",
  payload: {
    tmdb_id: r.tmdb_id,
    movie_name: r.movie_name,
    release_kind: r.release_kind,
    release_on: r.release_on,
  },
});

// Sender for digest emails. Set the RESEND_FROM secret to a verified-domain
// address (e.g. "Reel <alerts@yourdomain>"); resend.dev's shared test sender
// only delivers to the Resend account owner, so leaving it unset would silently
// drop every recipient's mail. When unset we skip sending (and report it)
// rather than send from a sender nobody but the owner receives.
const EMAIL_FROM = Deno.env.get("RESEND_FROM");

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const resendKey = Deno.env.get("RESEND_API_KEY");

  // One queryable row per exit path (job_runs, migration 0029) — including the
  // common zero-pending day and the error exits, so a missing recent row always
  // means the job didn't complete. Best-effort — never fail the run on it.
  const startedAt = new Date().toISOString();
  const logRun = (ok: boolean, summary: unknown) =>
    admin.from("job_runs").insert({
      job: "alerts",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok,
      summary,
    }).then(() => {}, () => {});

  // Las dos fuentes en paralelo: son independientes y ninguna espera a la otra.
  const [episodes, movies] = await Promise.all([
    admin.rpc("pending_new_episode_alerts"),
    admin.rpc("pending_movie_release_alerts"),
  ]);
  /* Una fuente caída no se lleva la otra por delante. Cada aviso tiene una
     ventana de 24 h y el cron corre una vez al día: cortar la corrida entera
     porque una de las dos consultas falló tira también los avisos que estaban
     perfectamente, y esos no vuelven. Se avisa de lo que hay y el fallo queda
     en el informe del run, que es donde se mira si algo dejó de salir. */
  const failed = [
    episodes.error ? `episodes: ${episodes.error.message}` : null,
    movies.error ? `movies: ${movies.error.message}` : null,
  ].filter(Boolean) as string[];
  if (failed.length === 2) {
    await logRun(false, { error: failed.join(" | ") });
    return new Response(JSON.stringify({ error: failed.join(" | ") }), { status: 500 });
  }
  const episodeRows = (episodes.data ?? []) as Pending[];
  const movieRows = (movies.data ?? []) as PendingMovie[];
  const rows: Alertable[] = [
    ...episodeRows.map(episodeAlertable),
    ...movieRows.map(movieAlertable),
  ];

  const report = {
    // Presente siempre, vacío cuando las dos fuentes respondieron: un informe
    // con `sourceErrors` lleno dice que ese día faltó la mitad de los avisos
    // aunque el resto saliera bien, y es donde se mira si algo dejó de salir.
    sourceErrors: failed,
    pending: rows.length,
    pendingEpisodes: episodeRows.length,
    pendingMovies: movieRows.length,
    recorded: 0, inappInserted: 0, emailsSent: 0, emailFailed: 0, emailSkipped: 0, users: 0,
  };
  if (rows.length === 0) {
    await logRun(true, report);
    return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
  }

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  report.users = userIds.length;

  /* Preferencias POR TIPO: quien sigue series y cine puede querer el correo de
     una cosa y no de la otra, y son dos filas distintas de notification_prefs.
     Fila ausente → in-app encendida, correo apagado, igual que siempre. */
  const { data: prefRows } = await admin
    .from("notification_prefs")
    .select("user_id, type, inapp, email")
    .in("type", ["new_episode", "movie_release"])
    .in("user_id", userIds);
  const prefs = new Map((prefRows ?? []).map((p: Any) => [`${p.user_id}:${p.type}`, p]));
  const inappOn = (r: Alertable) => prefs.get(`${r.user_id}:${r.type}`)?.inapp ?? true;
  const emailOn = (r: Alertable) => prefs.get(`${r.user_id}:${r.type}`)?.email ?? false;

  // ── Atomic dedupe: record the ledger FIRST, alert only what it accepted.
  // ON CONFLICT DO NOTHING … RETURNING (ignoreDuplicates + select) hands back
  // only the (user, episode) pairs this run actually inserted. So a retry after
  // a mid-run crash (ledger written, notifications not) won't re-alert, and two
  // concurrent runs can't both claim the same pair. The ledger is the source of
  // truth; in-app rows and emails are derived from what it accepted.
  const { data: recorded, error: se } = await admin
    .from("notifications_sent")
    .upsert(
      rows.map((r) => ({ user_id: r.user_id, episode_id: r.episode_id, event: r.event })),
      // `event` entra en el conflicto desde 0071: sin él, el aviso de streaming
      // de una película se sella contra el de cines —misma fila de episodes— y
      // se descarta como duplicado de algo que no es.
      { onConflict: "user_id,episode_id,event", ignoreDuplicates: true },
    )
    .select("user_id, episode_id, event");
  if (se) {
    await logRun(false, { error: se.message });
    return new Response(JSON.stringify({ error: se.message }), { status: 500 });
  }

  const key = (r: { user_id: string; episode_id: string; event: string }) =>
    `${r.user_id}:${r.episode_id}:${r.event}`;
  const fresh = new Set((recorded ?? []).map((r: Any) => key(r)));
  const freshRows = rows.filter((r) => fresh.has(key(r)));
  report.recorded = freshRows.length;
  if (freshRows.length === 0) {
    await logRun(true, report);
    return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
  }

  // in-app notifications for opted-in recipients (only the freshly-recorded rows)
  const notifRows = freshRows
    .filter(inappOn)
    .map((r) => ({ user_id: r.user_id, type: r.type, payload: r.payload }));
  if (notifRows.length) {
    const { error: ne } = await admin.from("notifications").insert(notifRows);
    if (ne) {
      await logRun(false, { error: ne.message });
      return new Response(JSON.stringify({ error: ne.message }), { status: 500 });
    }
    report.inappInserted = notifRows.length;
  }

  // one digest email per opted-in recipient with fresh episodes. Resolve each
  // address individually — listUsers() returns only the first page, silently
  // dropping recipients past it.
  // Con el correo encendido en AL MENOS uno de los dos tipos; el digest luego
  // solo lleva las filas de los tipos que esa persona sí quiere por correo.
  const emailUsers = [...new Set(freshRows.filter(emailOn).map((r) => r.user_id))];
  // Nadie con el correo encendido en un tipo del que hoy no hay nada: sin esto
  // el informe los contaba como "se les dejó de enviar" algo que no existía.
  if (emailUsers.length > 0) {
    if (!resendKey || !EMAIL_FROM) {
      // Missing key or verified sender → in-app notifications still landed
      // above; record the skip instead of sending mail nobody would receive.
      report.emailSkipped = emailUsers.length;
    } else {
      for (const uid of emailUsers) {
        const { data: authUser } = await admin.auth.admin.getUserById(uid);
        const to = authUser?.user?.email;
        if (!to) continue;
        const mine = freshRows.filter((r) => r.user_id === uid && emailOn(r));
        if (mine.length === 0) continue;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to,
            subject: emailSubject(mine),
            html: digestHtml(mine),
            text: digestText(mine),
          }),
        });
        if (res.ok) report.emailsSent++;
        else report.emailFailed++; // surfaced in the run report instead of swallowed
      }
    }
  }

  // ok is false if any email send failed.
  await logRun(report.emailFailed === 0, report);

  return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
});
