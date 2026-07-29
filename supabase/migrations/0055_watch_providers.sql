-- 0055_watch_providers.sql
-- Where a show can actually be watched, per country.
--
-- `titles.network` is TMDB's *original* broadcast network (`networks[0]`), so a
-- viewer in Spain has always been shown ABC, NBC or FX — true about the show's
-- provenance, useless for "where do I put this on tonight". TMDB's
-- watch/providers answers the second question and is keyed by ISO 3166-1
-- alpha-2, which is exactly what the country picker already stores.
--
-- Shape: {"ES": [{"name": "Netflix", "logo_path": "/x.jpg"}, …], "DE": […]}
-- — every region TMDB knows about, in one column, because the API returns them
-- all in a single call. A viewer changing country therefore needs no refetch.
--
-- Only subscription-shaped access is kept (flatrate / free / ads), ordered by
-- TMDB's own display_priority for that country. Rent and buy are dropped at
-- write time: Apple TV and Google Play carry nearly everything for rent, so
-- keeping them would put the same two logos on every older show and drown the
-- signal this column exists to carry. A title with no subscription provider in
-- your country stores an absent/empty entry and the UI shows no logo at all —
-- that absence is the honest answer.
--
-- `network` stays exactly as it is: the profile's "top networks" still counts
-- HBO and AMC, which is a fact about your taste that shouldn't change because
-- Netflix lost a licence.

alter table public.titles add column if not exists providers jsonb;

comment on column public.titles.providers is
  'TMDB watch/providers by ISO 3166-1 alpha-2: {"ES":[{"name","logo_path"}]}. Subscription-shaped only (flatrate/free/ads), TMDB display_priority order.';

-- No index: providers is only ever read alongside a title already being fetched
-- by tmdb_id, never filtered or joined on.
