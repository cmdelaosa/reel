-- 0025_popular_now_cache.sql
-- 24h cache of the "Popular now" ranking (shows with a recent or imminent
-- season premiere, by TMDB popularity). Written by the tmdb-proxy /popular-now
-- route (service role); read by authenticated.

create table public.popular_now_cache (
  tmdb_id   int primary key,
  rank      int not null,
  cached_at timestamptz not null default now()
);

alter table public.popular_now_cache enable row level security;
revoke all on public.popular_now_cache from anon, authenticated;
grant select on public.popular_now_cache to authenticated;
grant all on public.popular_now_cache to service_role;

create policy "popular_now_cache: authenticated read"
  on public.popular_now_cache for select to authenticated using (true);
