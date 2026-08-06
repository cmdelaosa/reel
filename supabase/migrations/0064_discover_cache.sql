-- 0064_discover_cache.sql
-- A server-side cache for the discover grids, and the reason the Explore tabs
-- stopped taking seconds to appear.
--
-- /trending and /popular-now had one each (trending_cache, popular_now_cache).
-- /popular and /top-rated had none: every single request re-fetched five to
-- eight TMDB pages and re-upserted a couple of hundred title rows before it
-- could answer. The client's 1h staleTime hid that inside one session and hid
-- it from nobody opening the app fresh.
--
-- One table instead of a third and fourth bespoke one. The key is the route
-- plus its parameters ('top-rated:from=1990&to=1999&genres=18'), the value is
-- the ordered tmdb_id list the route resolved to — the title rows themselves
-- already live in public.titles, so this only has to remember the ORDER, which
-- is the part that costs a TMDB round trip to work out.
--
-- Reads are service-role only (the proxy). Unlike trending_cache there is no
-- authenticated grant: nothing in the client reads this directly, and an
-- ordering of tmdb_ids is meaningless without the proxy's ranking rules.

create table public.discover_cache (
  cache_key text primary key,          -- e.g. 'popular:' , 'top-rated:genres=18'
  tmdb_ids  bigint[] not null,
  cached_at timestamptz not null default now()
);

create index discover_cache_cached_at_idx on public.discover_cache (cached_at);

alter table public.discover_cache enable row level security;
revoke all on public.discover_cache from anon, authenticated;
grant all on public.discover_cache to service_role;

comment on table public.discover_cache is
  'Ordered tmdb_id lists for the /popular and /top-rated proxy routes, keyed by '
  'route + params. Freshness is enforced by the proxy against cached_at, not by '
  'a trigger — see supabase/functions/tmdb-proxy/index.ts (DISCOVER_TTL_MS).';
