-- 0036_backfill_import_added_at.sql
-- One-off backfill. The TV Time importer never set library_entries.added_at, so
-- every imported follow got the DB default now() (the import moment) and surfaces
-- in friend activity (0018 rpc_friend_activity reads added_at for the "added"
-- verb) as "added today", burying the real, historically-dated watch events.
-- Backdate added_at to a real historical moment so both the activity feed and the
-- "recently added" library sort reflect the true timeline.
--
-- Historical date, in priority order (the real "followed since" date lives only
-- in the export zip, not the DB, so this SQL can't use it — the importer does,
-- going forward; see scripts/tvtime-import/lib.ts):
--   1. earliest watch of the show  -> min(watch_events.watched_at)
--   2. else the show's premiere     -> min(episodes.air_datetime), or
--      titles.first_air_date when no episode air dates are cached.
--
-- Scope: only the two accounts that have imported (kman, cmdelaosa).
-- library_entries has no `source` column, so imported rows can't be told apart
-- from in-app follows in SQL — hence the explicit handles. Portable no-op in any
-- environment where those handles don't exist (subquery yields no rows).
--
-- Guard: only ever move added_at BACKWARD (new < current), so a genuine recent
-- in-app follow is never pushed into the past. Re-running is a no-op (the second
-- pass computes the same, now-equal date, which fails the strict-less-than).

update public.library_entries le
set added_at = c.new_added_at
from (
  select
    le2.user_id,
    le2.title_id,
    coalesce(
      (select min(wv.watched_at)
         from public.watch_events wv
         join public.episodes e on e.id = wv.episode_id
        where wv.user_id = le2.user_id
          and e.title_id = le2.title_id),
      (select min(e.air_datetime)
         from public.episodes e
        where e.title_id = le2.title_id
          and e.season_number > 0),
      t.first_air_date::timestamptz
    ) as new_added_at
  from public.library_entries le2
  join public.titles t on t.id = le2.title_id
  where le2.user_id in (
    select id from public.profiles where handle in ('kman', 'cmdelaosa')
  )
) c
where le.user_id = c.user_id
  and le.title_id = c.title_id
  and c.new_added_at is not null
  and c.new_added_at < le.added_at;  -- only ever move backward
