# Deploy runbook — hosted Supabase + Cloudflare

The ordered, one-time cutover to production. The frontend is a static Vite build
served by a Cloudflare Worker; the backend is a hosted Supabase project. Do the
Supabase steps **before** the frontend step so the client has a backend to talk to.

> The app originally launched on Vercel and moved to Cloudflare in July 2026;
> [MIGRATION-CLOUDFLARE.md](MIGRATION-CLOUDFLARE.md) records that move and the
> reasoning. Nothing on Vercel remains.

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
supabase functions deploy tmdb-proxy igdb-proxy episode-refresh alerts importer export \
  friend-request-email
```

Deploy migrations before the functions. `tmdb-proxy` uses the
`is_current_user_invited()` function introduced in migration 0033 to combine
JWT/invite validation into one database round trip. Deploying the function
first would make metadata requests return 401 until the migration lands.

⚠️ **Migration 0071 and `alerts` must go out back to back**, in the same
sitting. It is the one pair where neither order is safe on its own: 0071
rewrites the primary key of `notifications_sent`, so the *old* `alerts` upserts
against a unique constraint that no longer exists and the whole run errors —
while the *new* `alerts` against the old schema asks for an `event` column that
isn't there yet. The daily cron only gets one shot at each alert: a run that
fails leaves nothing sealed, and by the next day the 24-hour window has closed
and those alerts are gone. Push the migration and deploy the function in the
same window, then check `select * from job_runs where job = 'alerts'` after the
next scheduled run.
The same order matters for 0060 (both ingest paths write `episodes.air_date`,
which that migration adds) and for 0061 (the friend-request trigger calls
`friend-request-email` through pg_net — the reverse order just means no mail
until the function lands, which pg_net swallows silently).

## 3. Set edge-function secrets

```bash
supabase secrets set TMDB_API_KEY=...        # TMDB v4 read access token (or v3 key)
supabase secrets set IGDB_CLIENT_ID=...       # Twitch app Client ID  (videojuegos)
supabase secrets set IGDB_CLIENT_SECRET=...   # Twitch app Client Secret
supabase secrets set RESEND_API_KEY=...       # Resend API key
supabase secrets set RESEND_FROM="Reel <alerts@yourdomain.com>"   # verified domain
```

`TMDB_API_KEY` takes either credential TMDB issues, and the code picks the
transport from the shape: a **v4 read access token** (a JWT, `eyJ…`, on the same
API settings page as the key) goes in an `Authorization` header, a **v3 key**
(32 hex) has to go in the query string because TMDB accepts it no other way.
Prefer the token — a credential in a URL is one failed connection away from
being quoted back in an error message, which is how this one reached both the
browser and `job_runs`. Swapping the secret is enough; nothing else changes.

**IGDB (videojuegos).** IGDB es de Twitch y su API va por *client credentials*:
un solo par de credenciales del PROYECTO, no un login por usuario. Se sacan una
vez en [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) — cuenta
de Twitch con 2FA activado, "Register Your Application", **OAuth Redirect URL**
`http://localhost` (IGDB no la usa, pero el formulario la exige) y **Client
Type: Confidential**, que es lo que habilita el botón de generar el secreto.
Sin estos dos secretos `igdb-proxy` responde 500 a todo y el modo de juegos se
queda sin catálogo; el resto de la app no se entera.

El límite de IGDB son **4 peticiones por segundo por Client ID**, compartidas
entre todos los usuarios de la app — no por usuario, como en TMDB. Por eso
`igdb-proxy` sirve siempre de la caché de `titles` y solo va a la red cuando no
hay fila o tiene más de 24 h.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Without `RESEND_FROM` the alerts function **skips email** (it will
not fall back to resend.dev, which only delivers to the account owner), and so
does `friend-request-email` — both record the skip in `job_runs` rather than
sending from an address nobody receives.

`friend-request-email` is called by a database trigger through pg_net, which
reads the service-role key from Vault under the name `episode_refresh_service_key`
— **the same secret the crons use**, the one `supabase/deploy/schedule-jobs.sql`
creates in step 5 below. Provision that and the trigger is wired; there is no
second secret to create.

It has to be spelled that way and not the obvious `service_role_key`: the name is
inherited from the first cron that needed it, and nothing in this project has ever
held a secret by any other name (the long comment at step 2 of `schedule-jobs.sql`
has the history). Migration `0070_friend_request_email_vault_name.sql` exists
precisely because `0061` got this wrong, and the failure is invisible — the lookup
returns NULL, the mailer's `if v_key is null then return` guard fires, and there is
no `job_runs` row, no pg_net request, and nothing in `net._http_response` to find.
The in-app notification keeps working throughout, so it reads as a broken mailer
rather than a missing secret. If friend-request mail ever goes quiet, check the
name first:

```sql
select name from vault.secrets;   -- expect episode_refresh_service_key
```

## 4. Configure Auth (hosted dashboard → Authentication)

- **URL Configuration**: set **Site URL** to the app's public domain and add it
  (plus `http://localhost:5173` for local) to **Redirect URLs**. Magic-link and
  OAuth redirects fail without this. Prune stale origins here whenever the app
  moves host — a redirect allowlist that still names a dead domain is a loose end.
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

The daily `episode-refresh`, `discover-warm` and `alerts` jobs have **no
automatic scheduling** — nothing in the migrations sets them up. Provision them
once:

1. Open `supabase/deploy/schedule-jobs.sql`.
2. Replace `<PROJECT_REF>` (every job) and `<SERVICE_ROLE_KEY>` (Vault step) —
   for the second one read [Which service key](#which-service-key) first, it is
   not the one the name suggests.
3. Run it in the hosted **SQL Editor**.

Then confirm:

```sql
select jobname, schedule, active from cron.job;   -- expect all three, active
```

### Which service key

Every one of these functions authenticates a caller as the cron by comparing the
bearer token against its own injected `SUPABASE_SERVICE_ROLE_KEY`, byte for byte
(`isCron` in tmdb-proxy, the 401 guard in episode-refresh). So the only value
that works is whatever Supabase injects — and since the project moved to the new
API key system, that is the **`sb_secret_…` secret key**, not the legacy
`service_role` JWT the dashboard still shows under Project Settings → API.

Measured against `tmdb-proxy/warm` on 2026-08-24:

| what you send | what comes back |
|---|---|
| `sb_secret_…` | `{"ok":true,"summary":{…}}` |
| legacy `service_role` JWT (CLI) | `{"error":"not invited"}` — reaches the function, fails the comparison |
| legacy `service_role` JWT (dashboard) | `{"code":"UNAUTHORIZED_LEGACY_JWT"}` — never reaches it |

The middle row is the cruel one: a 403 that reads like an invite-gate problem
when it is actually the wrong key. Get the right one without it touching your
history:

```bash
SR=$(supabase projects api-keys --project-ref <ref> --reveal -o env | grep '^SUPABASE_DEFAULT_KEY=' | cut -d= -f2- | tr -d '"')
```

`SUPABASE_DEFAULT_KEY` is the `sb_secret_…` one. The `tr -d '"'` is not optional:
`-o env` quotes its values, and the quotes travel inside the header and come back
as `UNAUTHORIZED_INVALID_JWT_FORMAT`.

⚠️ The live project's Vault already holds a working value — the crons run green
daily, check `job_runs`. Only re-run the Vault step if you are provisioning a new
project or the crons have actually stopped; seeding it with the legacy JWT would
break all three at once, and the 401 dies inside `net._http_response` where
nobody is looking.

`schedule-jobs.sql` also fires two one-time calls:

- `episode-refresh?force=1`, which recomputes every followed title's derivations
  (aired_count, upcoming_season_…) immediately instead of waiting for the daily
  run to reach it. Re-run that curl (step 7) any time — each invocation covers a
  few hundred titles before the wall guard stops it, oldest-refreshed first, so a
  full library takes several.
- `tmdb-proxy/warm`, which fills the Explore discovery caches. Skipping it isn't
  harmful, only slow: the first person to open Explore rebuilds them instead,
  and a cold `popular-now` costs ~80 sequential TMDB fetches.

IMDb ratings are not part of this job at all — they come from the hourly
`imdb-ratings` GitHub Action (see ARCHITECTURE → Metadata cache), which needs the
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` **repo secrets** rather than
Supabase function secrets.

### One-off backfills (run in rounds, driven by the data)

Fire these **from the SQL editor**, the way the cron does — `net.http_post` with
the key read out of the Vault. A `curl` works too, but it needs the *right* key
in your shell: see [Which service key](#which-service-key) — this paragraph used
to say the `sb_secret_…` one was not it, and that is now backwards. The Vault
secret's name is `episode_refresh_service_key` — what `schedule-jobs.sql` creates
and what every caller now reads — and not the obvious `service_role_key`, which
no project here has ever held.

```sql
select name from vault.secrets;   -- expect episode_refresh_service_key
```

```sql
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh?backfillImdbIds=1',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb
);
-- the response lands here a moment later; 401 usually means the secret name is wrong
select status_code, content from net._http_response order by id desc limit 1;
```

Each round works until the runtime stops it and commits as it goes, so re-running
is always safe — but these rounds are killed on the runtime's CPU limit **before**
they write their `job_runs` row (observed: ~2 min in, ~260 titles done, no log
line). Judge progress by the counts, never by the run log:

```sql
-- re-fire until it stops falling
select count(*) from titles where imdb_id is null;
select count(*) from episodes where season_number > 0 and tmdb_vote_average is null;
```

1. **`?backfillImdbIds=1`** — `imdb_id` across the whole cache. Without it the
   ratings importer cannot see a show at all, which is why titles nobody follows
   had no episode graph. ~260 titles a round, so a few thousand takes several.
   What stays null is real: shows TMDB has no IMDb id for, plus the odd deleted
   tmdb_id (a 404).
2. **`?force=1&allSeasons=1`** — per-episode TMDB scores on the older seasons the
   daily run never touches. The heavier of the two.

## 6. Deploy the frontend (Cloudflare Workers)

- Cloudflare dashboard → **Workers & Pages → Create → Connect a repository**.
- **Worker name** `reel` — it must match `name` in `app/wrangler.jsonc` or the
  build fails. **Root directory** `app`. **Build command**
  `npm run check && npm run build` (lint + unit tests gate the deploy).
  Deploy command: `npx wrangler deploy`. The SPA fallback lives in
  `wrangler.jsonc` (`not_found_handling`), not in a rewrite file.
- Build variables — **Settings → Build → Build Variables and Secrets**, *not*
  the runtime "Variables & Secrets": Vite inlines them at build time.
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_GOOGLE_AUTH=true`
  only if you enabled Google in step 4.
- Do **not** set `VITE_DEV_AUTOLOGIN_*` — dev-only, and inert in a prod build
  anyway (`import.meta.env.DEV` is false).

⚠️ Missing build vars do **not** fail the build: it goes green and serves a
blank app from a vendor-only bundle (~30 KB of JS). Verify by bundle size
(~800 KB+), never by the green check. Full setup, DNS and the custom-domain
steps: [MIGRATION-CLOUDFLARE.md](MIGRATION-CLOUDFLARE.md).

## 7. Verify (do all of these before inviting anyone)

- [ ] Magic-link login works **to a non-team email address** (proves custom SMTP).
- [ ] A fresh signup is walled at `/invite` until it redeems a code, and can't
      write data before then (invite gate).
- [ ] Manually invoke each cron once and check the JSON report. A
      `{"error":"not invited"}` here means you used the legacy JWT rather than
      the `sb_secret_…` key, not that anything is wrong with the deploy — see
      [Which service key](#which-service-key).
      ```bash
      SR=$(supabase projects api-keys --project-ref <ref> --reveal -o env | grep '^SUPABASE_DEFAULT_KEY=' | cut -d= -f2- | tr -d '"')
      curl -X POST https://<ref>.supabase.co/functions/v1/episode-refresh \
        -H "Authorization: Bearer $SR"
      curl -X POST https://<ref>.supabase.co/functions/v1/alerts \
        -H "Authorization: Bearer $SR"
      # expect {"ok":true,"summary":{"trending":24,"popular-now":48,…}} — a zero
      # or an "error: …" string in any slot means that cache stayed cold.
      # It is also the TMDB credential check: every slot at zero is TMDB
      # rejecting TMDB_API_KEY.
      curl -X POST https://<ref>.supabase.co/functions/v1/tmdb-proxy/warm \
        -H "Authorization: Bearer $SR"
      ```
- [ ] After ~a day (or a manual run), `select jobname, status, return_message
      from cron.job_run_details order by start_time desc limit 5;` shows
      `succeeded`.
- [ ] A test alert email actually arrives (verified sender + SMTP).
- [ ] After the crons run, `select job, ok, started_at, summary from public.job_runs
      order by started_at desc limit 10;` shows a recent `ok = true` row for each job.
      (Glance at this weekly — a silently-failing daily job shows up here.)
