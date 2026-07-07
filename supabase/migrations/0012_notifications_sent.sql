-- 0012_notifications_sent.sql
-- Dedupe ledger for the alerts job + a helper listing pending new-episode
-- alerts. Both service-role only.

create table public.notifications_sent (
  user_id    uuid not null references public.profiles on delete cascade,
  episode_id uuid not null references public.episodes on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (user_id, episode_id)
);

alter table public.notifications_sent enable row level security;
revoke all on public.notifications_sent from anon, authenticated;
grant all on public.notifications_sent to service_role;  -- no policies → service role only

-- Episodes of followed shows that aired in the last 24h and haven't been
-- notified to that user yet. Called by the alerts edge function (service role).
create function public.pending_new_episode_alerts()
returns table (
  user_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  season_number int,
  episode_number int,
  episode_name text
)
language sql
security invoker
stable
as $$
  select le.user_id, e.id, t.id, t.tmdb_id, t.name, e.season_number, e.episode_number, e.name
  from public.episodes e
  join public.titles t on t.id = e.title_id
  join public.library_entries le on le.title_id = t.id and le.followed
  where e.season_number > 0
    and e.air_datetime > now() - interval '24 hours'
    and e.air_datetime <= now()
    and not exists (
      select 1 from public.notifications_sent ns
      where ns.user_id = le.user_id and ns.episode_id = e.id
    )
$$;

grant execute on function public.pending_new_episode_alerts() to service_role;
