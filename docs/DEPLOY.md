# Deploy runbook — hosted Supabase + Vercel

> **Frontend section superseded.** The app has since moved to **Cloudflare
> Workers** at [reel-app.com](https://reel-app.com) — §6 (Vercel) is kept as the
> record of the original cutover, and the current hosting setup lives in
> [MIGRATION-CLOUDFLARE.md](MIGRATION-CLOUDFLARE.md). The Supabase-side steps
> are still the reference.

The ordered, one-time cutover to production (PLAN.md P1-C5). The frontend is a
static Vite build on Vercel; the backend is a hosted Supabase project. Do the
Supabase steps **before** the Vercel step so the client has a backend to talk to.

> Why this doc exists: the app is invite-only *and* leans entirely on RLS +
> scheduled edge functions. Several production requirements have no local
> equivalent (custom SMTP, cron scheduling, secrets) and are easy to forget —
> the 2026-07-12 audit found the crons unscheduled and emails undeliverable.
> Follow this list top to bottom and run the verification at the end.

## 0. Prerequisites

- A hosted Supabase project (note its **project ref** — the subdomain of the API
  URL, `https://<ref>.supabase.co`).
- A [Resend](https://resend.com) account with a **verified sending domain**.
- Supabase CLI logged in (`supabase login`).

## 1. Link the project and push the schema

```bash
supabase link --project-ref <ref>
supabase db push          # applies every migration in supabase/migrations
```

⚠️ **Do not seed prod.** `supabase/seed/dev.sql` creates demo accounts
(`password123`) and open invite codes — it's for local `supabase db reset` only.
`supabase db push` does not run it; never run `supabase db reset` against the
linked hosted DB.

## 2. Deploy the edge functions

```bash
supabase functions deploy tmdb-proxy episode-refresh alerts importer export
```

Deploy migrations before the functions. `tmdb-proxy` uses the
`is_current_user_invited()` function introduced in migration 0033 to combine
JWT/invite validation into one database round trip. Deploying the function
first would make metadata requests return 401 until the migration lands.

## 3. Set edge-function secrets

```bash
supabase secrets set TMDB_API_KEY=...        # TMDB v3 API key
supabase secrets set RESEND_API_KEY=...       # Resend API key
supabase secrets set RESEND_FROM="Reel <alerts@yourdomain.com>"   # verified domain
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Without `RESEND_FROM` the alerts function **skips email** (it will
not fall back to resend.dev, which only delivers to the account owner).

## 4. Configure Auth (hosted dashboard → Authentication)

- **URL Configuration**: set **Site URL** to your Vercel domain and add it (plus
  `http://localhost:5173` for local) to **Redirect URLs**. Magic-link and OAuth
  redirects fail without this.
- **SMTP (required for real users)**: Auth → **SMTP Settings** → enable custom
  SMTP using your Resend SMTP credentials from the verified domain. Supabase's
  built-in mailer is test-only, rate-limited to a few/hour, and on newer projects
  **only delivers to project team members** — friends would never get a login
  link. Raise the auth email rate limit while you're here.
- **Signup stays enabled** (`enable_signup = true`). The invite gate is enforced
  server-side (migration 0027 + the edge functions' `is_invited` check), so an
  un-invited account can log in but can do nothing. Disabling signup would block
  invited friends from creating an account to redeem their code.
- **Google (optional)**: only if you want it — enable the Google provider here,
  then build the client with `VITE_GOOGLE_AUTH=true` (otherwise the button is
  hidden by design; see LoginPage).

## 5. Schedule the cron jobs

The daily `episode-refresh` and `alerts` jobs have **no automatic scheduling** —
nothing in the migrations sets them up. Provision them once:

1. Open `supabase/deploy/schedule-jobs.sql`.
2. Replace `<PROJECT_REF>` (both jobs) and `<SERVICE_ROLE_KEY>` (Vault step, from
   Dashboard → Project Settings → API).
3. Run it in the hosted **SQL Editor**.

Then confirm:

```sql
select jobname, schedule, active from cron.job;   -- expect both jobs, active
```

`schedule-jobs.sql` also fires a one-time `episode-refresh?force=1`, which
recomputes every followed title's derivations (aired_count, upcoming_season_…)
immediately instead of waiting for the daily run to reach it. Re-run that curl
(step 7) any time — each invocation covers a few hundred titles before the wall
guard stops it, oldest-refreshed first, so a full library takes several.

IMDb ratings are not part of this job at all — they come from the weekly
`imdb-ratings` GitHub Action (see ARCHITECTURE → Metadata cache), which needs the
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` **repo secrets** rather than
Supabase function secrets.

## 6. Deploy the frontend (Vercel)

- Import the repo; set the **Root Directory** to `app/`.
- Build command `npm run build`, output `dist` (SPA rewrite is in
  `app/vercel.json`).
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and
  `VITE_GOOGLE_AUTH=true` only if you enabled Google in step 4).
- Do **not** set `VITE_DEV_AUTOLOGIN_*` — dev-only, and inert in a prod build
  anyway (`import.meta.env.DEV` is false).

## 7. Verify (do all of these before inviting anyone)

- [ ] Magic-link login works **to a non-team email address** (proves custom SMTP).
- [ ] A fresh signup is walled at `/invite` until it redeems a code, and can't
      write data before then (invite gate).
- [ ] Manually invoke each cron once and check the JSON report:
      ```bash
      curl -X POST https://<ref>.supabase.co/functions/v1/episode-refresh \
        -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
      curl -X POST https://<ref>.supabase.co/functions/v1/alerts \
        -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
      ```
- [ ] After ~a day (or a manual run), `select jobname, status, return_message
      from cron.job_run_details order by start_time desc limit 5;` shows
      `succeeded`.
- [ ] A test alert email actually arrives (verified sender + SMTP).
- [ ] After the crons run, `select job, ok, started_at, summary from public.job_runs
      order by started_at desc limit 10;` shows a recent `ok = true` row for each job.
      (Glance at this weekly — a silently-failing daily job shows up here.)
