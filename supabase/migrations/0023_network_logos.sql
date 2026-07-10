-- 0023_network_logos.sql
-- name → TMDB logo_path map for streaming networks/channels. Written by the
-- tmdb-proxy + episode-refresh (service role) whenever a show's `networks[]`
-- carry a logo; read by authenticated. The client's NetworkLogo component looks
-- up the current show's `network` name here to render the official brand image
-- instead of a two-letter monogram.

-- logo_dark: true when the brand logo is dark-on-transparent (e.g. HBO, FX, AMC
-- are pure-black wordmarks) and needs a light tile behind it; false when it's
-- light/white (needs a dark tile). Measured from the logo's pixels by the
-- backfill script; null until measured (client falls back to a dark tile).
create table public.network_logos (
  name       text primary key,
  logo_path  text,
  logo_dark  boolean,
  updated_at timestamptz not null default now()
);

alter table public.network_logos enable row level security;
revoke all on public.network_logos from anon, authenticated;
grant select on public.network_logos to authenticated;
grant all on public.network_logos to service_role;

create policy "network_logos: authenticated read"
  on public.network_logos for select to authenticated using (true);
