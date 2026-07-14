-- 0039_kman_added_at_first_air.sql
-- One-off backfill: kman's TV Time import. 0036 backdated added_at to the
-- earliest watch (else premiere), but for kman the preferred timeline is the
-- show's premiere date across the board — every imported follow reads "added"
-- at the series' first air date.
--
-- Scope: kman only, and only rows that predate the account (created 2026-07-13
-- 09:30 UTC; the import ran 09:33). Verified against prod on 2026-07-14: all
-- 231 of kman's library entries are imported (added_at between 1998 and
-- 2026-05, none on/after account creation) and every one has a titles.first_air_date.
-- Follows added later in-app carry added_at >= account creation, so the guard
-- leaves them untouched and re-running is a no-op. Portable no-op where the
-- handle doesn't exist.

update public.library_entries le
set added_at = t.first_air_date::timestamptz
from public.titles t
where t.id = le.title_id
  and le.user_id in (select id from public.profiles where handle = 'kman')
  and le.added_at < timestamptz '2026-07-13 09:30:00+00'
  and t.first_air_date is not null
  and le.added_at is distinct from t.first_air_date::timestamptz;
