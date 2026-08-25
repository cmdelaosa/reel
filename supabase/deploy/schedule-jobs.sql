-- schedule-jobs.sql — one-shot provisioning of the daily cron jobs on HOSTED
-- Supabase. NOT a migration (it needs the hosted project + the service-role key,
-- neither of which exists at `supabase db push` time). Run it once, by hand,
-- after deploying the edge functions. See docs/DEPLOY.md.
--
-- Before running: replace <PROJECT_REF> below with your project ref (the
-- subdomain of your project's API URL, e.g. abcdefgh in
-- https://abcdefgh.supabase.co), and set the service-role key secret in the
-- Vault step (mind its name — see step 2). Run it in the hosted SQL editor
-- (or `supabase db execute`).

-- 1. Extensions: cron scheduler + HTTP client for pg_cron → edge function calls.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the service-role key in Vault so the cron body can send it as the
--    bearer token every one of these functions requires (they 401 otherwise —
--    tmdb-proxy/warm rejects anything that is not this exact key).
--
--    IT IS THE `sb_secret_…` KEY, NOT THE service_role JWT. What the functions
--    compare against is their injected SUPABASE_SERVICE_ROLE_KEY, and since the
--    project moved to the new API key system that is the secret key, not the
--    legacy JWT the dashboard still lists under Project Settings → API. Seeding
--    this with the JWT breaks all three crons at once, and the failure is
--    invisible: tmdb-proxy answers {"error":"not invited"} — a 403 that reads
--    like an invite-gate bug — and pg_net buries it in net._http_response.
--    Get the right one with:
--      supabase projects api-keys --project-ref <ref> --reveal -o env \
--        | grep '^SUPABASE_DEFAULT_KEY=' | cut -d= -f2- | tr -d '"'
--    See docs/DEPLOY.md → "Which service key" for the measured comparison.
--
--    Idempotent-ish: if you re-run, delete the old secret first
--    (`select vault.delete_secret('episode_refresh_service_key');`) to avoid
--    duplicates. The live project's Vault already holds a working value — check
--    public.job_runs before touching it.
--
--    THE NAME IS LOAD-BEARING and it is not the obvious one. The live project
--    stores this as `episode_refresh_service_key` — named after the first cron
--    that needed it, and since inherited by every other. This file used to say
--    `service_role_key`, which no project has ever held; the subquery then
--    returned NULL, `'Bearer ' || NULL` collapsed to NULL, and the header was
--    dropped from the request entirely. What comes back is a platform-gateway
--    401 (`UNAUTHORIZED_NO_AUTH_HEADER`) that looks exactly like a bad key, so
--    it reads as "wrong secret" rather than "no secret by that name" — and
--    pg_net swallows it into net._http_response, where nobody is looking.
--    If you rename it, rename it in every call site below at the same time.
select vault.create_secret('<SERVICE_ROLE_KEY>', 'episode_refresh_service_key');

-- 3a. episode-refresh — daily 05:00 UTC. Refreshes titles + latest seasons.
select cron.schedule(
  'episode-refresh-daily',
  '0 5 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 3b. discover-warm — daily 04:40 UTC. Rebuilds the four Explore discovery
--     caches (trending, popular-now, popular, top-rated) before anyone opens
--     the app, so no reader is the one who pays to refill them. Without it the
--     first visitor after the 24h TTL lapsed wore a cold popular-now rebuild:
--     ~80 sequential TMDB detail fetches, seconds of blank grid.
--     Scheduled 20 min ahead of episode-refresh so the two heaviest TMDB
--     consumers don't share a rate-limit window. The gap used to matter for a
--     worse reason: this job writes `titles.last_refreshed_at` for the whole
--     popular-now pool (it holds full TMDB details, so it upserts rich rows),
--     and episode-refresh used to gate on that same column — so any followed
--     title in the pool looked fresh 20 minutes later and was skipped, every
--     day. Migration 0066 split the two marks; the ordering here is now only
--     about rate limits, and moving either job is safe.
--     Check it like any other job:
--       select ok, summary, started_at from public.job_runs
--        where job = 'discover-warm' order by started_at desc limit 5;
select cron.schedule(
  'discover-warm-daily',
  '40 4 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/tmdb-proxy/warm',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- 3c. alerts — daily 05:30 UTC (after episode-refresh so it sees fresh episodes).
select cron.schedule(
  'alerts-daily',
  '30 5 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 3d. igdb-warm — daily 04:20 UTC. Rebuilds the four Explore grids of the games
--     mode (most anticipated, new releases, popular, top rated). Same job as
--     discover-warm, other catalogue, and MÁS necesario: IGDB gives the whole
--     project four requests per SECOND, shared by everyone — the same budget
--     every search and every game sheet comes out of. A cold Explore is four of
--     them spent at once, in the middle of the day, competing with whoever else
--     is using the app.
--     Twenty minutes before discover-warm only out of habit: the two limits are
--     unrelated (different API, different credential), so moving either is safe.
--     Check it like the others:
--       select ok, summary, started_at from public.job_runs
--        where job = 'igdb-warm' order by started_at desc limit 5;
select cron.schedule(
  'igdb-warm-daily',
  '20 4 * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/igdb-proxy/warm',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- 3e. imdb-id-backfill — cada hora, al :25. Resuelve `titles.imdb_id` de una
--     tanda de títulos que no lo tienen, series y películas
--     (episode-refresh?backfillImdbIds=1). Sin ese id, el importador horario de
--     notas de IMDb (.github/workflows/imdb-ratings.yml) no ve el título: no
--     hay nota que enseñar en la carátula ni en la ficha.
--
--     ERA UNA PASADA A MANO, y por eso está aquí ahora. En series casi daba
--     igual: /title's refresh path escribe el id de todo lo que alguien abre,
--     así que el hueco se cerraba solo. En cine no se cierra NUNCA — una peli
--     entra en la caché desde Explorar y desde la búsqueda, y ninguna de las
--     dos escribe imdb_id (movieSearchRow, en tmdb-proxy) — de modo que las
--     rejillas de Explorar se quedaban enteras sin nota. Con la nota de IMDb
--     como la de referencia del cine, eso pasó de detalle a agujero.
--
--     POR QUÉ CADA HORA y no una vez al día: la ronda está limitada por el
--     tiempo de CPU del runtime, no por la cola (~260 títulos por ronda), así
--     que el atraso acumulado solo se come a base de rondas. Una vez vacía la
--     cola el trabajo es una consulta y cero peticiones a TMDB — se queda
--     dormida sola, sin apagarla.
--
--     Puede solaparse con episode-refresh-daily (05:00): comparten el límite de
--     TMDB, un 429 se cuenta como error de la ronda y la siguiente lo reintenta.
--     Es idempotente por construcción: lo resuelto sale de la cola.
--
--     Mírala como las demás — y por los CONTEOS, que estas rondas mueren en el
--     límite de CPU antes de escribir su fila de job_runs:
--       select count(*) from titles where imdb_id is null and kind in ('tv','movie');
--       select count(*) from titles where kind = 'movie' and imdb_rating is not null;
select cron.schedule(
  'imdb-id-backfill-hourly',
  '25 * * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh?backfillImdbIds=1',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 3f. One-time backfill: fire episode-refresh NOW with ?force=1 so every
--     followed title gets its derivations (aired_count, upcoming_season_number)
--     recomputed immediately, bypassing the staleness gate — instead of waiting
--     up to ~a day for the daily cron to reach it. Safe to omit or re-run.
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/episode-refresh?force=1',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb
);

-- 3g. Fill the discovery caches NOW rather than waiting for tomorrow's 04:40 —
--     right after a deploy they are empty, which is exactly the cold-start this
--     job exists to prevent. Safe to re-run.
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/tmdb-proxy/warm',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 120000
);

-- 3h. Y las cuatro rejillas de juegos, por lo mismo.
select net.http_post(
  url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/igdb-proxy/warm',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'episode_refresh_service_key'),
    'Content-Type', 'application/json'
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 120000
);

-- 4. Verify. All five scheduled jobs should be listed; after the first fire,
--    job_run_details shows status='succeeded'.
--   select jobname, schedule, active from cron.job;
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--
-- To change a schedule, re-run cron.schedule with the SAME jobname (it upserts).
-- To remove: select cron.unschedule('episode-refresh-daily');
