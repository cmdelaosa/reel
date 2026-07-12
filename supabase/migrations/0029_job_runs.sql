-- 0029_job_runs.sql
-- Cron observability. episode-refresh and alerts reported outcomes only to
-- console.log (edge logs, ~1 day retention on free tier) and the HTTP response
-- body (which pg_cron/net.http_post discards). So a scheduled job could fail
-- every day for a month with no queryable signal.
--
-- This table gets one row per run. Ops-only: service_role (the crons) writes;
-- no anon/authenticated access — check it from the dashboard or SQL:
--   select job, ok, started_at, finished_at, summary
--     from public.job_runs order by started_at desc limit 20;

create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,                       -- 'episode-refresh' | 'alerts'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean not null default false,
  summary     jsonb not null default '{}'          -- refreshed/errors/etc.
);
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);

-- RLS on, no policy for anon/authenticated → only the service-role crons (which
-- bypass RLS) and the dashboard can read/write. Ops data, not user data.
alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;
grant all on public.job_runs to service_role;
