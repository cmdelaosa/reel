-- 0060_episode_air_date.sql
-- Keep TMDB's bare air_date alongside the instant, so a TVmaze stamp can be
-- checked against the day it claims to be.
--
-- 0051 started overwriting episodes.air_datetime with TVmaze's real airstamp —
-- a clock worth printing instead of the 21:00 UTC placeholder. The pairing was
-- season × episode number and nothing else, which assumes both catalogues count
-- episodes identically. Hot Ones season 30 is thirteen episodes on TMDB and
-- eleven on TVmaze (it lists neither the Tim Howard opener nor the J Balvin), so
-- TVmaze's 30x10 is our E12, and every episode of that season was stamped with a
-- later one's time — fourteen days out at the end, where the same two dates got
-- printed twice.
--
-- A wrong day is not a cosmetic problem: air_datetime is what
-- pending_new_episode_alerts (0059) windows on, and what the aired-count,
-- mark-up-to and up-next gates compare against now(). Those episodes were
-- announced a fortnight late and couldn't be marked watched until then.
--
-- The fix (app/src/domain/airPairing.ts, hand-mirrored into both ingest paths)
-- pairs on the DAY: TVmaze publishes `airdate`, the broadcaster's local day,
-- next to the stamp, and it has to equal TMDB's air_date. But the anchor has to
-- survive in our own rows too — enrichAirTimes is handed a title id and re-reads
-- the episodes, and on an already-corrupted row the stored day is TVmaze's, not
-- TMDB's, so there was nothing left to judge it by. Hence this column: the raw
-- TMDB day, written by the same upsert that writes the rest of the payload.
--
-- Correcting a row is then the ordinary path, not a repair script: the next
-- refresh records air_date, keepTvmazeTimes stops carrying an instant whose day
-- no longer matches, and the enrichment pass re-pairs it (usually finding the
-- same episode under TVmaze's own number, so the real clock is kept rather than
-- lost).
--
-- DEPLOY THIS BEFORE THE FUNCTIONS. Both ingest paths write air_date in the
-- episode upsert; against a database without the column every episode write
-- fails.
--
-- HOW FAR THE SELF-REPAIR REACHES. The nightly episode-refresh only rewrites a
-- title's latest two seasons, so that is where the anchor — and with it the
-- re-pairing — lands on its own, within a day for every followed show. Older
-- seasons keep air_date null and are deliberately left untouched (no anchor, no
-- judgement) until something writes one: opening that season in the app, which
-- goes through tmdb-proxy, or one manual round of
--
--   episode-refresh?force=1&allSeasons=1
--
-- which is the existing whole-show mode and rewrites every regular season. Run
-- it in rounds after deploying if the back catalogue matters; it is idempotent.

alter table public.episodes add column if not exists air_date date;

-- Backfill only the rows still holding the placeholder: those were written as
-- `air_date || 'T21:00:00Z'`, so the UTC date IS the TMDB day, exactly.
--
-- Rows sourced from TVmaze are deliberately left null. Their stored day is
-- TVmaze's — for the mis-paired ones, a day TMDB never reported — so seeding
-- from it would enshrine the very error this column exists to catch. Null means
-- "no anchor yet"; resolveAirTime leaves those rows untouched until the next
-- refresh writes the real day, which for a followed title is the next nightly
-- episode-refresh run.
update public.episodes
   set air_date = (air_datetime at time zone 'UTC')::date
 where air_date is null
   and air_datetime is not null
   and air_time_source = 'estimated';
