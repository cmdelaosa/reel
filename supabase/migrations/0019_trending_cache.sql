-- 0019_trending_cache.sql
-- 24h cache of TMDB weekly trending order. Written by the tmdb-proxy /trending
-- route (service role); read by authenticated.

create table public.trending_cache (
  tmdb_id   int primary key,
  rank      int not null,
  cached_at timestamptz not null default now()
);

alter table public.trending_cache enable row level security;
revoke all on public.trending_cache from anon, authenticated;
grant select on public.trending_cache to authenticated;
grant all on public.trending_cache to service_role;

create policy "trending_cache: authenticated read"
  on public.trending_cache for select to authenticated using (true);
