-- 0065_platform_air_times.sql
-- A third provenance for air_datetime: the streamer's own release time.
--
-- 0051 taught the ingest to replace the 21:00 UTC placeholder with TVmaze's
-- airstamp, and 0060 made TMDB's day the anchor that stamp has to land on.
-- Both assume TVmaze knows a clock. It only does for scheduled broadcasters:
-- for anything streamed its `airtime` is empty and the `airstamp` beside it is
-- a noon-UTC filler. We were printing that filler as fact — Stranger Things
-- announced itself at 14:00 Madrid for a drop that happens at 09:00.
--
-- Worse on Apple TV+, where the two catalogues disagree about the DAY. Apple
-- releases at 21:00 Pacific the evening before (= 00:00 Eastern on the day),
-- and TMDB's contributors file that Pacific date: every episode of Silo, and of
-- Ted Lasso from season 3, sits one day before TVmaze's. Anchored on TMDB and
-- stapled to the placeholder, Ted Lasso 4x02 landed on Aug 11 at 23:00 in
-- Madrid — a day before it exists, in the column the alert window (0059), the
-- aired / mark-up-to / up-next gates and the whole calendar key off.
--
-- So air_time_source gains 'platform': an instant derived from a standing
-- release rule (Apple TV+ midnight Eastern, Netflix / Disney+ / Prime Video
-- midnight Pacific) resolved in that platform's own zone, on the day the
-- platform really releases. The rule and its three locks live in
-- app/src/domain/airPairing.ts, hand-mirrored into both ingest paths.
--
-- 'platform' prints exactly like 'tvmaze' (hasRealAirTime): it IS the release
-- instant. Only 'estimated' stays unprinted.

do $$
begin
  alter table public.episodes drop constraint episodes_air_time_source_check;
exception
  when undefined_object then null;
end
$$;

alter table public.episodes
  add constraint episodes_air_time_source_check
  check (air_time_source in ('tvmaze', 'platform', 'estimated'));

-- Demote the filler now rather than at the next refresh. Every row TVmaze
-- stamped at exactly noon UTC is one it had no `airtime` for, and until the
-- ingest re-derives it (nightly for followed titles, on open for the rest) it
-- would go on claiming a broadcast time nobody publishes.
--
-- Safe in the one case this over-reaches — a broadcaster that genuinely airs at
-- 12:00 UTC — because the demotion is not permanent: the next enrichment pass
-- sees a real `airtime`, and puts the stamp straight back. The day is left
-- alone here; only the ingest may move that, and only under the locks.
update public.episodes
   set air_time_source = 'estimated',
       air_datetime = (air_date + time '21:00') at time zone 'UTC'
 where air_time_source = 'tvmaze'
   and air_date is not null
   and (air_datetime at time zone 'UTC')::time = time '12:00';
